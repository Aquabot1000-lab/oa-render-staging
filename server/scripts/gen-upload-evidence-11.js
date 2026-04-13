#!/usr/bin/env node
/**
 * Generate evidence PDFs from verified_analysis for 11 VERIFIED cases.
 * Upload to Supabase Storage. Update verified_analysis with URL.
 */
const { createClient } = require('@supabase/supabase-js');
const { generateEvidencePacket } = require('../services/evidence-generator');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://ylxreuqvofgbpsatfsvr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlseHJldXF2b2ZnYnBzYXRmc3ZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg1NzE4MCwiZXhwIjoyMDg3NDMzMTgwfQ.DxTv7ZC0oNRHBBS0Jxquh1M0wsGV8fQ005Q9S2iILdE';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BUCKET = 'evidence-export';
const VERIFIED_CASES = [
    'OA-0005','OA-0016','OA-0018','OA-0019','OA-0021','OA-0023',
    'OA-0025','OA-0033','OA-0046','OA-0048','OA-0056'
];

async function ensureBucket() {
    const { data: buckets } = await supabase.storage.listBuckets();
    const exists = buckets.some(b => b.name === BUCKET);
    if (!exists) {
        const { error } = await supabase.storage.createBucket(BUCKET, { public: false });
        if (error) console.error('Bucket create error:', error.message);
        else console.log('Created bucket:', BUCKET);
    } else {
        console.log('Bucket exists:', BUCKET);
    }
}

async function main() {
    await ensureBucket();

    const { data: cases } = await supabase
        .from('submissions')
        .select('*')
        .in('case_id', VERIFIED_CASES)
        .is('deleted_at', null);

    const results = [];

    for (const c of cases.sort((a, b) => a.case_id.localeCompare(b.case_id))) {
        const cid = c.case_id;
        const va = c.verified_analysis;

        if (!va || va.status !== 'VERIFIED') {
            console.log(`${cid}: SKIPPED (status: ${va?.status || 'null'})`);
            results.push({ cid, generated: false, uploaded: false, accessible: false, size: 0, reason: 'Not VERIFIED' });
            continue;
        }

        console.log(`\n${cid}: Generating PDF...`);

        // Map verified_analysis into the shapes the generator expects
        const caseData = {
            caseId: cid,
            ownerName: c.owner_name || '',
            propertyAddress: c.property_address || '',
            county: c.county || '',
            state: c.state || 'TX'
        };

        const propertyData = {
            assessedValue: va.cad_appraised_value || 0,
            sqft: c.sqft || 0,
            yearBuilt: c.year_built || null,
            propertyType: c.property_type || ''
        };

        // Build compResults from verified_analysis
        const comps = (va.comps || []).map(comp => {
            const sqft = comp.sqft || 0;
            const assessedVal = comp.assessedValue || 0;
            const pricePerSqft = sqft > 0 ? Math.round(assessedVal / sqft) : null;
            return {
                parcelId: comp.parcelId || '',
                accountId: comp.parcelId || '',
                address: comp.address || '',
                assessedValue: assessedVal,
                adjustedValue: assessedVal, // CAD comps — no sale price adjustments needed
                sqft: sqft,
                yearBuilt: comp.yearBuilt || null,
                pricePerSqft: pricePerSqft,
                score: comp.score || 0,
                source: comp.source || 'verified-cad',
                verified: true
            };
        });

        const compResults = {
            recommendedValue: va.recommended_value || 0,
            reduction: va.reduction || 0,
            estimatedSavings: va.estimated_savings || 0,
            comps: comps,
            methodology: `Market value determined through analysis of ${comps.length} verified comparable properties ` +
                `sourced from ${c.county} County Appraisal District records. ` +
                `All comps verified against official CAD data — no synthetic or estimated values used. ` +
                `Recommended value based on median of comparable assessed values. ` +
                `Tax rate: ${(va.tax_rate_used * 100).toFixed(2)}% (from ${c.county} County ${new Date().getFullYear()} verified rate table). ` +
                `Engine: v${va.engine_version}. Data source: ${va.data_source}. ` +
                `Confidence: ${va.confidence || 'N/A'}. Variance: ${va.variance_pct != null ? va.variance_pct + '%' : 'N/A'}.`,
            primaryStrategy: 'market_value'
        };

        try {
            // Generate PDF
            const pdfPath = await generateEvidencePacket(caseData, propertyData, compResults);
            const fileSize = fs.statSync(pdfPath).size;
            console.log(`  Generated: ${pdfPath} (${fileSize.toLocaleString()} bytes)`);

            if (fileSize < 5000) {
                console.log(`  ⚠️ WARNING: File too small — likely placeholder`);
                results.push({ cid, generated: true, uploaded: false, accessible: false, size: fileSize, reason: 'File too small' });
                continue;
            }

            // Upload to Supabase Storage
            const storagePath = `${cid}/evidence.pdf`;
            const fileBuffer = fs.readFileSync(pdfPath);

            // Delete existing if any
            await supabase.storage.from(BUCKET).remove([storagePath]);

            const { data: uploadData, error: uploadErr } = await supabase.storage
                .from(BUCKET)
                .upload(storagePath, fileBuffer, {
                    contentType: 'application/pdf',
                    upsert: true
                });

            if (uploadErr) {
                console.log(`  ❌ Upload failed: ${uploadErr.message}`);
                results.push({ cid, generated: true, uploaded: false, accessible: false, size: fileSize, reason: uploadErr.message });
                continue;
            }
            console.log(`  Uploaded: ${BUCKET}/${storagePath}`);

            // Generate signed URL (7 days)
            const { data: urlData, error: urlErr } = await supabase.storage
                .from(BUCKET)
                .createSignedUrl(storagePath, 7 * 24 * 60 * 60);

            if (urlErr) {
                console.log(`  ❌ Signed URL failed: ${urlErr.message}`);
                results.push({ cid, generated: true, uploaded: true, accessible: false, size: fileSize, reason: urlErr.message });
                continue;
            }

            const signedUrl = urlData.signedUrl;
            console.log(`  Signed URL: ${signedUrl.substring(0, 80)}...`);

            // Test accessibility
            let accessible = false;
            try {
                const resp = await fetch(signedUrl, { method: 'HEAD' });
                accessible = resp.ok;
                console.log(`  Accessible: ${accessible} (HTTP ${resp.status})`);
            } catch (e) {
                console.log(`  Accessibility check failed: ${e.message}`);
            }

            // Update verified_analysis with evidence URL
            const updatedVA = { ...va, evidence_url: signedUrl, evidence_generated_at: new Date().toISOString() };
            await supabase.from('submissions').update({ verified_analysis: updatedVA }).eq('id', c.id);
            console.log(`  DB updated with evidence_url`);

            results.push({ cid, generated: true, uploaded: true, accessible, size: fileSize, url: signedUrl });

        } catch (err) {
            console.error(`  ❌ ERROR: ${err.message}`);
            results.push({ cid, generated: false, uploaded: false, accessible: false, size: 0, reason: err.message });
        }
    }

    // Summary table
    console.log(`\n${'='.repeat(100)}`);
    console.log('RESULTS');
    console.log('='.repeat(100));
    console.log(`${'Case'.padEnd(10)}${'Generated'.padEnd(12)}${'Uploaded'.padEnd(10)}${'Accessible'.padEnd(12)}${'Size'.padEnd(12)}Notes`);
    console.log('-'.repeat(100));
    for (const r of results) {
        console.log(`${r.cid.padEnd(10)}${(r.generated?'YES':'NO').padEnd(12)}${(r.uploaded?'YES':'NO').padEnd(10)}${(r.accessible?'YES':'NO').padEnd(12)}${r.size > 0 ? (r.size.toLocaleString()+'B').padEnd(12) : '—'.padEnd(12)}${r.reason||''}`);
    }

    // Sample URL
    const firstSuccess = results.find(r => r.accessible && r.url);
    if (firstSuccess) {
        console.log(`\nSAMPLE SIGNED URL (${firstSuccess.cid}):`);
        console.log(firstSuccess.url);
    }

    const generated = results.filter(r => r.generated).length;
    const uploaded = results.filter(r => r.uploaded).length;
    const accessible = results.filter(r => r.accessible).length;
    console.log(`\nTOTALS: ${generated} generated | ${uploaded} uploaded | ${accessible} accessible | ${results.length} total`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
