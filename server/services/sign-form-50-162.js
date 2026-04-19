/**
 * sign-form-50-162.js
 * Generates a final signed Form 50-162 PDF by:
 * 1. Running the Python generator to pre-fill fields for a customer
 * 2. Overlaying the captured signature image + date onto Step 6 (page 2)
 * 3. Uploading to Supabase Storage
 * 4. Inserting a record in case_documents
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { PDFDocument } = require('pdf-lib');

const GENERATOR_SCRIPT = path.join(__dirname, 'form-50-162-generator.py');
const TEMPLATE_PATH = path.join(__dirname, '../../templates/form-50-162-agent-appointment.pdf');
const OUTPUT_DIR = path.join(__dirname, '../../generated-forms');

const AGENT_INFO = {
    name: 'OverAssessed LLC',
    phone: '(210) 315-8885',
    address: '6002 Camp Bullis, Suite 208',
    city_state_zip: 'San Antonio, TX 78257'
};

// County → Appraisal District mapping (mirrors Python script)
const COUNTY_TO_AD = {
    bexar: 'Bexar Appraisal District',
    tarrant: 'Tarrant Appraisal District',
    denton: 'Denton Central Appraisal District',
    harris: 'Harris County Appraisal District',
    travis: 'Travis Central Appraisal District',
    williamson: 'Williamson Central Appraisal District',
    collin: 'Collin Central Appraisal District',
    dallas: 'Dallas Central Appraisal District',
    'fort bend': 'Fort Bend Central Appraisal District',
    'el paso': 'El Paso Central Appraisal District',
    comal: 'Comal Appraisal District',
    wichita: 'Wichita Appraisal District',
    nueces: 'Nueces County Appraisal District',
    galveston: 'Galveston Central Appraisal District',
    montgomery: 'Montgomery Central Appraisal District',
};

/**
 * Parse address into parts for the form
 */
function parseAddressParts(address) {
    if (!address) return { street: '', cityStateZip: '' };
    const parts = address.split(',').map(s => s.trim());
    if (parts.length >= 3) {
        return { street: parts[0], cityStateZip: parts.slice(1).join(', ') };
    } else if (parts.length === 2) {
        return { street: parts[0], cityStateZip: parts[1] };
    }
    return { street: address, cityStateZip: '' };
}

/**
 * Step 1: Generate pre-filled PDF using Python script
 */
function generatePrefilledPDF(caseData) {
    const { street, cityStateZip } = parseAddressParts(caseData.property_address);
    const county = (caseData.county || '').toLowerCase();
    const adName = COUNTY_TO_AD[county] || `${caseData.county || ''} Appraisal District`;

    const caseJson = JSON.stringify({
        case_id: caseData.case_id,
        owner_name: caseData.owner_name || '',
        phone: (caseData.phone || '').replace(/\D/g, '').replace(/^1/, '').replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3'),
        property_address: street || caseData.property_address || '',
        owner_address: street || caseData.property_address || '',
        owner_city_state_zip: cityStateZip || '',
        county: caseData.county || '',
        account_number: caseData.account_number || '',
        legal_description: caseData.legal_description || ''
    });

    const result = spawnSync('python3', [GENERATOR_SCRIPT, caseJson, JSON.stringify(AGENT_INFO)], {
        encoding: 'utf8', timeout: 30000
    });

    if (result.status !== 0) {
        throw new Error(`PDF generator failed: ${result.stderr || result.stdout}`);
    }

    const outputLine = (result.stdout || '').trim().split('\n').find(l => l.startsWith('Generated:'));
    if (!outputLine) throw new Error(`Generator did not return output path. stdout: ${result.stdout}`);
    return outputLine.replace('Generated: ', '').trim();
}

/**
 * Step 2: Overlay signature image + date onto the pre-filled PDF
 * Signature field (page 2): rect [68.15, 242.50, 363.75, 274.50]
 * Date field (page 2): rect [378.94, 242.32, 581.13, 258.66]
 */
async function overlaySignature(prefilledPath, signatureDataUrl, signedAt) {
    const existingPdfBytes = fs.readFileSync(prefilledPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    const pages = pdfDoc.getPages();
    const page2 = pages[1]; // 0-indexed, page 2
    const { height } = page2.getSize();

    // Decode signature PNG from data URL
    const base64Data = signatureDataUrl.replace(/^data:image\/\w+;base64,/, '');
    const imgBytes = Buffer.from(base64Data, 'base64');

    let sigImage;
    if (signatureDataUrl.startsWith('data:image/png')) {
        sigImage = await pdfDoc.embedPng(imgBytes);
    } else {
        sigImage = await pdfDoc.embedJpg(imgBytes);
    }

    // Signature rect in PDF coords (bottom-left origin): [68.15, 242.50, 363.75, 274.50]
    // PDF coords: y from bottom. rect[1] = bottom, rect[3] = top
    const sigX = 68.15;
    const sigY = 242.50;          // bottom of sig field in PDF units
    const sigW = 363.75 - 68.15;  // ~295 pts wide
    const sigH = 274.50 - 242.50; // ~32 pts tall — expand a bit for readability
    const padded = sigH * 1.8;    // give signature more vertical room

    page2.drawImage(sigImage, {
        x: sigX,
        y: sigY - (padded - sigH) / 2,
        width: sigW,
        height: padded,
        opacity: 0.95
    });

    // Date: format as MM/DD/YYYY
    const dateStr = signedAt
        ? new Date(signedAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
        : new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });

    // Draw date text at Date field position: [378.94, 242.32, 581.13, 258.66]
    const { rgb } = require('pdf-lib');
    page2.drawText(dateStr, {
        x: 380,
        y: 246,
        size: 10,
        color: rgb(0, 0, 0)
    });

    const signedPdfBytes = await pdfDoc.save();
    const signedPath = prefilledPath.replace('.pdf', '_SIGNED.pdf');
    fs.writeFileSync(signedPath, signedPdfBytes);
    return signedPath;
}

/**
 * Step 3: Upload to Supabase Storage + insert case_documents record
 */
async function storeSignedPDF(supabase, caseId, signedPath, ownerName) {
    const fileBytes = fs.readFileSync(signedPath);
    const fileName = path.basename(signedPath);
    const storagePath = `signed-forms/${caseId}/${fileName}`;

    // Upload to Supabase storage bucket 'documents'
    const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('documents')
        .upload(storagePath, fileBytes, {
            contentType: 'application/pdf',
            upsert: true
        });

    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

    // Get public URL
    const { data: urlData } = supabase.storage.from('documents').getPublicUrl(storagePath);
    const publicUrl = urlData?.publicUrl || null;

    // Insert into case_documents (uses file_type column)
    const { data: docRow, error: docErr } = await supabase.from('case_documents').insert({
        case_id: caseId,
        file_type: 'signed_50_162',
        file_name: fileName,
        file_url: publicUrl,
        uploaded_by: 'system',
        notes: `Signed Form 50-162 — ${ownerName || caseId}`
    }).select().single();

    if (docErr) {
        console.error('[sign-form] case_documents insert error:', docErr.message);
    }

    // Also update submissions with the signed form URL
    await supabase.from('submissions').update({
        agreement_url: publicUrl,
        last_activity_at: new Date().toISOString()
    }).eq('case_id', caseId);

    // Clean up local pre-filled (unsigned) file, keep signed
    try { fs.unlinkSync(signedPath.replace('_SIGNED.pdf', '.pdf')); } catch {}

    return { publicUrl, storagePath, docId: docRow?.id };
}

/**
 * Main entry point — called from esign route after signature is captured
 */
async function generateAndStoreSigned(supabase, { caseId, ownerName, propertyAddress, county, phone, accountNumber, signatureDataUrl, signedAt }) {
    const caseData = {
        case_id: caseId,
        owner_name: ownerName,
        property_address: propertyAddress,
        county: county || '',
        phone: phone || '',
        account_number: accountNumber || '',
        legal_description: ''
    };

    console.log(`[sign-form] ▶ Starting pipeline for case ${caseId}`);
    console.log(`[sign-form]   owner: ${ownerName}, county: ${county}, address: ${propertyAddress}`);
    console.log(`[sign-form]   template: ${TEMPLATE_PATH}`);
    console.log(`[sign-form]   template exists: ${fs.existsSync(TEMPLATE_PATH)}`);
    console.log(`[sign-form]   output dir: ${OUTPUT_DIR}`);
    console.log(`[sign-form]   generator script: ${GENERATOR_SCRIPT}`);
    console.log(`[sign-form]   generator exists: ${fs.existsSync(GENERATOR_SCRIPT)}`);
    console.log(`[sign-form]   signature data length: ${signatureDataUrl ? signatureDataUrl.length : 0}`);

    // 1. Generate pre-filled PDF
    let prefilledPath;
    try {
        prefilledPath = generatePrefilledPDF(caseData);
        console.log(`[sign-form] ✅ Step 1 — Pre-filled PDF: ${prefilledPath}`);
    } catch (err) {
        console.error(`[sign-form] ❌ Step 1 FAILED — Pre-fill PDF generation: ${err.message}`);
        throw err;
    }

    // 2. Overlay signature + date
    let signedPath;
    try {
        signedPath = await overlaySignature(prefilledPath, signatureDataUrl, signedAt);
        console.log(`[sign-form] ✅ Step 2 — Signature overlay: ${signedPath}`);
    } catch (err) {
        console.error(`[sign-form] ❌ Step 2 FAILED — Signature overlay: ${err.message}`);
        throw err;
    }

    // 3. Store in Supabase
    let stored;
    try {
        stored = await storeSignedPDF(supabase, caseId, signedPath, ownerName);
        console.log(`[sign-form] ✅ Step 3 — Stored: ${stored.publicUrl}`);
    } catch (err) {
        console.error(`[sign-form] ❌ Step 3 FAILED — Storage/DB: ${err.message}`);
        throw err;
    }

    // Clean up local signed file after upload
    try { fs.unlinkSync(signedPath); } catch {}

    return stored;
}

module.exports = { generateAndStoreSigned };
