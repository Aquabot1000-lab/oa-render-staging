/**
 * sign-wa-package.js
 *
 * Generates a final signed WA filing package PDF by:
 * 1. Building the prefilled WA Form 64-0075 + LOA via wa-package-generator.js
 * 2. Overlaying the captured signature image + date onto:
 *    - Form 64-0075 page 2: Signature Field 1 + Text Field 165 (date)
 *    - LOA page 1: Property Owner signature line + date
 * 3. Combining into a single signed PDF
 * 4. Computing SHA-256 of the final bytes
 * 5. Uploading to Supabase Storage (bucket: documents)
 * 6. Inserting case_documents row with file_type='signed_wa_package'
 *
 * NOTE: NO Texas / Form 50-162 references anywhere. WA-only path.
 */

'use strict';

const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { generateWAPackage } = require('./wa-package-generator');

// Form 64-0075 page 2 widget rectangles (verified via pdf-lib widget inspection)
const PETITION_SIG_RECT = { x1: 188.9, y1: 276.1, x2: 471.6, y2: 289.3 }; // Signature Field 1
const PETITION_DATE_RECT = { x1: 505.8, y1: 276.1, x2: 576.0, y2: 289.3 }; // Text Field 165

function fmtDate(iso) {
    const d = iso ? new Date(iso) : new Date();
    return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
}

function decodeSignaturePng(signatureDataUrl) {
    if (!signatureDataUrl) throw new Error('signatureDataUrl required');
    const base64 = signatureDataUrl.replace(/^data:image\/\w+;base64,/, '');
    return Buffer.from(base64, 'base64');
}

/**
 * Overlay signature on the prefilled Petition PDF (page 2 Signature Field 1 + date).
 * Returns final flattened PDF Buffer.
 */
async function overlayPetitionSignature(petitionBuf, signatureDataUrl, signedAt) {
    const doc = await PDFDocument.load(petitionBuf);
    const pages = doc.getPages();
    if (pages.length < 2) throw new Error('Form 64-0075 has fewer than 2 pages');
    const page2 = pages[1];

    const imgBytes = decodeSignaturePng(signatureDataUrl);
    let sigImage;
    if (signatureDataUrl.startsWith('data:image/png')) {
        sigImage = await doc.embedPng(imgBytes);
    } else {
        sigImage = await doc.embedJpg(imgBytes);
    }

    // Signature Field 1 rect: [188.9, 276.1, 471.6, 289.3]
    const sigW = PETITION_SIG_RECT.x2 - PETITION_SIG_RECT.x1; // ~282.7
    const sigH = PETITION_SIG_RECT.y2 - PETITION_SIG_RECT.y1; // ~13.2
    const padded = sigH * 2.0;
    page2.drawImage(sigImage, {
        x: PETITION_SIG_RECT.x1,
        y: PETITION_SIG_RECT.y1 - (padded - sigH) / 2,
        width: sigW,
        height: padded,
        opacity: 0.95,
    });

    // Date in Text Field 165 (MM/DD/YYYY) — set via AcroForm so it survives flatten
    const dateStr = fmtDate(signedAt);
    let form;
    try {
        form = doc.getForm();
        try {
            const dateField = form.getTextField('Text Field 165');
            dateField.setText(dateStr);
        } catch (e) {
            console.warn('[sign-wa] Date field set failed, drawing as overlay:', e.message);
            page2.drawText(dateStr, {
                x: PETITION_DATE_RECT.x1 + 2,
                y: PETITION_DATE_RECT.y1 + 2,
                size: 10,
                color: rgb(0, 0, 0),
            });
        }
    } catch (e) {
        console.warn('[sign-wa] getForm() failed:', e.message);
    }

    // Also draw the date on top as belt-and-suspenders so it shows even if the form
    // appearance stream renders the field empty (some viewers do).
    page2.drawText(dateStr, {
        x: PETITION_DATE_RECT.x1 + 2,
        y: PETITION_DATE_RECT.y1 + 2,
        size: 10,
        color: rgb(0, 0, 0),
    });

    // Flatten the AcroForm so the prefilled values + signature are locked
    if (form) {
        try {
            form.flatten();
        } catch (e) {
            console.warn('[sign-wa] form.flatten() warning:', e.message);
        }
    }

    const out = await doc.save();
    return Buffer.from(out);
}

/**
 * Overlay signature on the LOA page 1 using the anchor from generateWAPackage.
 */
async function overlayLOASignature(loaBuf, signatureDataUrl, signedAt, anchor) {
    const doc = await PDFDocument.load(loaBuf);
    const pages = doc.getPages();
    const page = pages[anchor.page || 0];

    const imgBytes = decodeSignaturePng(signatureDataUrl);
    let sigImage;
    if (signatureDataUrl.startsWith('data:image/png')) {
        sigImage = await doc.embedPng(imgBytes);
    } else {
        sigImage = await doc.embedJpg(imgBytes);
    }

    // The LOA signature line sits at sigLineY; place signature image above it
    // (a bit overlapping so it looks signed-on-the-line).
    const sigImgHeight = 32;
    const sigImgWidth = anchor.sigLineWidth - 10;
    page.drawImage(sigImage, {
        x: anchor.sigLineX + 2,
        y: anchor.sigLineY - 2, // hang slightly below baseline for natural look
        width: sigImgWidth,
        height: sigImgHeight,
        opacity: 0.95,
    });

    // Date on the date line
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText(fmtDate(signedAt), {
        x: anchor.dateLineX + 4,
        y: anchor.dateLineY + 4,
        size: 11,
        font: helv,
        color: rgb(0, 0, 0),
    });

    const out = await doc.save();
    return Buffer.from(out);
}

async function combinePDFs(petitionBuf, loaBuf) {
    const out = await PDFDocument.create();
    for (const buf of [petitionBuf, loaBuf]) {
        const src = await PDFDocument.load(buf);
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach(pg => out.addPage(pg));
    }
    const bytes = await out.save();
    return Buffer.from(bytes);
}

/**
 * Main entry point — called by the e-sign route after a WA signature is captured.
 *
 * @param {SupabaseClient} supabase
 * @param {object} args
 * @returns {Promise<{publicUrl: string, storagePath: string, hash: string}>}
 */
async function generateAndStoreSignedWA(supabase, args) {
    const {
        caseId,
        ownerName,
        propertyAddress,    // full string ("2449 Snyder Ave., Bremerton, WA 98312")
        propertyCity,
        propertyState,
        propertyZip,
        county,
        parcel,             // parcel number
        ownerOpinion,       // numeric or string
        email,
        phone,
        assessmentYear,
        taxPayableYear,
        assessorTotal,
        assessorLand,
        assessorImprovements,
        ownerLand,
        ownerImprovements,
        compMedian,
        compMin,
        compMax,
        compCount,
        signatureDataUrl,
        signedAt,
    } = args;

    if (!signatureDataUrl) throw new Error('signatureDataUrl required');
    if (!caseId) throw new Error('caseId required');

    console.log(`[sign-wa] ▶ Starting WA pipeline for case ${caseId}`);
    console.log(`[sign-wa]   owner: ${ownerName}, county: ${county}, parcel: ${parcel}`);

    // Parse property address into parts if not pre-split
    let pCity = propertyCity, pState = propertyState || 'WA', pZip = propertyZip, pStreet = propertyAddress;
    if ((!pCity || !pZip) && propertyAddress) {
        // "2449 Snyder Ave., Bremerton, WA 98312"
        const parts = propertyAddress.split(',').map(s => s.trim());
        if (parts.length >= 3) {
            pStreet = parts[0];
            pCity = pCity || parts[1];
            const stateZip = parts[2].split(/\s+/);
            pState = pState || stateZip[0];
            pZip = pZip || stateZip.slice(1).join(' ');
        }
    }

    const ownerTotalNum = typeof ownerOpinion === 'number'
        ? ownerOpinion
        : parseInt(String(ownerOpinion || '0').replace(/[^\d.-]/g, ''), 10) || 0;

    const facts = {
        caseId,
        ownerName: ownerName || '',
        propertyAddress: pStreet || propertyAddress || '',
        propertyCity: pCity || '',
        propertyState: pState || 'WA',
        propertyZip: pZip || '',
        parcelNumber: parcel || '',
        county: county || '',
        email: email || '',
        phone: phone || '',
        assessmentYear: assessmentYear || new Date().getFullYear(),
        taxPayableYear: taxPayableYear || (new Date().getFullYear() + 1),
        assessorLand: assessorLand || 0,
        assessorImprovements: assessorImprovements || 0,
        assessorTotal: assessorTotal || 0,
        ownerLand: ownerLand || 0,
        ownerImprovements: ownerImprovements != null
            ? ownerImprovements
            : Math.max(ownerTotalNum - (ownerLand || 0), 0),
        ownerTotal: ownerTotalNum,
        compMedian: compMedian || ownerTotalNum,
        compMin: compMin || 0,
        compMax: compMax || 0,
        compCount: compCount || 0,
    };

    // 1. Build prefilled package
    const { petitionPdfBytes, loaPdfBytes, loaSignatureAnchor } =
        await generateWAPackage(facts);
    console.log(`[sign-wa] ✅ Prefilled package built (petition=${petitionPdfBytes.length}b, loa=${loaPdfBytes.length}b)`);

    // 2. Overlay signature on each
    const signedPetition = await overlayPetitionSignature(petitionPdfBytes, signatureDataUrl, signedAt);
    const signedLOA = await overlayLOASignature(loaPdfBytes, signatureDataUrl, signedAt, loaSignatureAnchor);
    console.log(`[sign-wa] ✅ Signature overlaid on petition + LOA`);

    // 3. Combine
    const combined = await combinePDFs(signedPetition, signedLOA);
    console.log(`[sign-wa] ✅ Combined signed PDF (${combined.length}b)`);

    // 4. Hash
    const hash = crypto.createHash('sha256').update(combined).digest('hex');
    console.log(`[sign-wa]   sha256: ${hash}`);

    // 5. Upload to Supabase
    const ts = Date.now();
    const fileName = `OA-${caseId}-WA-Signed-Package-${ts}.pdf`;
    const storagePath = `signed-forms/OA-${caseId}/${fileName}`;
    // NOTE: caseId may already be "OA-0037"; avoid double-prefix
    const cleanPath = storagePath.replace('signed-forms/OA-OA-', 'signed-forms/OA-');
    const finalPath = caseId.startsWith('OA-')
        ? `signed-forms/${caseId}/${caseId}-WA-Signed-Package-${ts}.pdf`
        : storagePath;

    const { error: upErr } = await supabase.storage
        .from('documents')
        .upload(finalPath, combined, { contentType: 'application/pdf', upsert: true });
    if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

    const { data: urlData } = supabase.storage.from('documents').getPublicUrl(finalPath);
    const publicUrl = urlData?.publicUrl || null;
    console.log(`[sign-wa] ✅ Uploaded to ${finalPath}`);

    // 6. case_documents row
    const docFileName = caseId.startsWith('OA-')
        ? `${caseId}-WA-Signed-Package.pdf`
        : `OA-${caseId}-WA-Signed-Package.pdf`;
    const { error: docErr } = await supabase.from('case_documents').insert({
        case_id: caseId,
        file_type: 'signed_wa_package',
        file_name: docFileName,
        file_url: publicUrl,
        file_hash: hash,
        uploaded_by: 'system',
        notes: `WA signed package (Form 64-0075 + LOA) — ${ownerName || caseId}`,
        uploaded_at: new Date().toISOString(),
    });
    if (docErr) {
        // file_hash / uploaded_at may not exist; retry with minimal payload
        console.warn('[sign-wa] case_documents insert warning, retrying minimal:', docErr.message);
        const { error: retryErr } = await supabase.from('case_documents').insert({
            case_id: caseId,
            file_type: 'signed_wa_package',
            file_name: docFileName,
            file_url: publicUrl,
            uploaded_by: 'system',
            notes: `WA signed package (Form 64-0075 + LOA) — ${ownerName || caseId} | sha256=${hash}`,
        });
        if (retryErr) {
            console.error('[sign-wa] case_documents retry insert error:', retryErr.message);
        }
    }

    return { publicUrl, storagePath: finalPath, hash };
}

module.exports = {
    generateAndStoreSignedWA,
    // exposed for tests
    overlayPetitionSignature,
    overlayLOASignature,
};
