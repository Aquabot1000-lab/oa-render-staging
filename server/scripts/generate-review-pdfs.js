#!/usr/bin/env node
/**
 * Generate Review PDFs for verified OA cases
 * INTERNAL REVIEW ONLY — NOT for customer distribution
 */

const { Pool } = require('pg');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = '/Users/aquabot/Documents/OverAssessed/evidence-export/review-pdfs';

const pool = new Pool({
    connectionString: 'postgresql://postgres:h1AVVY1oXH9kJcwz@db.ylxreuqvofgbpsatfsvr.supabase.co:5432/postgres',
    ssl: { rejectUnauthorized: false }
});

// Confidence assessment
function assessConfidence(row) {
    const flags = [];
    let level = 'HIGH';
    const comps = row.comp_details || [];
    const subjectAV = parseFloat(row.subject_assessed_value) || 0;
    const recVal = parseFloat(row.recommended_value) || 0;
    const avgCompVal = comps.length > 0 ? comps.reduce((s, c) => s + (c.assessedValue || 0), 0) / comps.length : 0;

    // Check comp value ratio to subject
    if (avgCompVal > 0 && subjectAV > 0) {
        const ratio = avgCompVal / subjectAV;
        if (ratio > 5) {
            level = 'LOW';
            flags.push(`⚠️ COMP VALUES GROSSLY MISMATCHED: avg comp $${Math.round(avgCompVal).toLocaleString()} vs subject $${subjectAV.toLocaleString()} (${Math.round(ratio)}x)`);
        } else if (ratio < 0.6 || ratio > 2.5) {
            level = 'LOW';
            flags.push(`⚠️ COMP VALUES FAR FROM SUBJECT: avg comp $${Math.round(avgCompVal).toLocaleString()} vs subject $${subjectAV.toLocaleString()}`);
        } else if (ratio < 0.75 || ratio > 1.5) {
            if (level === 'HIGH') level = 'MEDIUM';
            flags.push(`Comp value spread wider than ideal: avg $${Math.round(avgCompVal).toLocaleString()} vs subject $${subjectAV.toLocaleString()}`);
        }
    }

    // Check comp count
    if (comps.length < 5) {
        if (level === 'HIGH') level = 'MEDIUM';
        flags.push(`Only ${comps.length} comps (minimum threshold)`);
    }

    // Check if $0 savings
    const savings = parseFloat(row.estimated_savings) || 0;
    if (savings === 0 || !row.reduction || parseFloat(row.reduction) <= 0) {
        flags.push('$0 savings — property appears fairly assessed or under-assessed');
    }

    // Check score distribution
    const minScore = Math.min(...comps.map(c => c.score || 0));
    if (minScore < 50) {
        if (level === 'HIGH') level = 'MEDIUM';
        flags.push(`Weakest comp score: ${minScore}/100`);
    }

    // Check reduction percentage
    if (recVal > 0 && subjectAV > 0) {
        const reductionPct = ((subjectAV - recVal) / subjectAV) * 100;
        if (reductionPct > 30) {
            if (level === 'HIGH') level = 'MEDIUM';
            flags.push(`Large reduction: ${reductionPct.toFixed(1)}% — ARB may challenge`);
        }
    }

    return { level, flags };
}

function getSourceLink(county, pid) {
    const c = county?.toLowerCase();
    if (c === 'tarrant') return `https://www.tad.org/property/${pid}`;
    if (c === 'bexar') return `https://bexar.trueautomation.com/clientdb/Property.aspx?prop_id=${pid}`;
    if (c === 'kaufman') return `https://esearch.kaufman-cad.org/Property/View?Id=${pid}&year=2026`;
    if (c === 'travis') return `https://esearch.traviscad.org/Property/View?Id=${pid}&year=2026`;
    return `#`;
}

function generateHTML(row, confidence) {
    const comps = (row.comp_details || []).slice(0, 5);
    const county = row.subject_county || '';
    const savings = parseFloat(row.estimated_savings) || 0;
    const subjectAV = parseFloat(row.subject_assessed_value) || 0;
    const recVal = parseFloat(row.recommended_value) || subjectAV;
    const reduction = parseFloat(row.reduction) || 0;
    const reductionPct = subjectAV > 0 ? ((reduction / subjectAV) * 100).toFixed(1) : '0.0';
    const oldSavings = parseFloat(row.old_savings) || 0;
    const taxRate = parseFloat(row.tax_rate) || 0.0225;
    const subjectLink = getSourceLink(county, row.subject_parcel_id);

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #222; font-size: 13px; }
    .header { border-bottom: 3px solid #1a5276; padding-bottom: 15px; margin-bottom: 20px; }
    .header h1 { font-size: 22px; color: #1a5276; }
    .header .subtitle { color: #666; font-size: 12px; margin-top: 4px; }
    .badge { display: inline-block; padding: 3px 12px; border-radius: 4px; font-weight: bold; font-size: 11px; color: white; }
    .badge-high { background: #27ae60; }
    .badge-medium { background: #f39c12; }
    .badge-low { background: #e74c3c; }
    .badge-group-a { background: #8e44ad; }
    .badge-group-b { background: #2980b9; }
    .badge-group-c { background: #7f8c8d; }
    .section { margin-bottom: 18px; }
    .section h2 { font-size: 14px; color: #1a5276; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12px; }
    th { background: #ecf0f1; text-align: left; padding: 6px 8px; font-weight: 600; border: 1px solid #ddd; }
    td { padding: 6px 8px; border: 1px solid #ddd; }
    tr:nth-child(even) { background: #f9f9f9; }
    .kv-table td:first-child { font-weight: 600; width: 200px; background: #f5f5f5; }
    .flags { background: #fef9e7; border: 1px solid #f0e68c; padding: 10px; border-radius: 4px; margin-top: 8px; }
    .flags li { margin-left: 18px; margin-bottom: 3px; }
    .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-35deg); font-size: 80px; color: rgba(200, 0, 0, 0.06); font-weight: bold; z-index: -1; pointer-events: none; }
    .savings-box { background: ${savings > 0 ? '#eafaf1' : '#fdedec'}; border: 2px solid ${savings > 0 ? '#27ae60' : '#e74c3c'}; padding: 12px; border-radius: 6px; text-align: center; margin: 10px 0; }
    .savings-box .amount { font-size: 28px; font-weight: bold; color: ${savings > 0 ? '#27ae60' : '#e74c3c'}; }
    .footer { margin-top: 30px; border-top: 1px solid #ddd; padding-top: 10px; font-size: 10px; color: #999; }
    a { color: #2980b9; text-decoration: none; }
</style>
</head>
<body>
<div class="watermark">INTERNAL REVIEW ONLY</div>

<div class="header">
    <h1>Property Tax Protest — Verified Analysis</h1>
    <div class="subtitle">
        ${row.case_id} | ${row.subject_county?.toUpperCase()} County | Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        &nbsp;&nbsp;
        <span class="badge badge-${confidence.level.toLowerCase()}">${confidence.level} CONFIDENCE</span>
        <span class="badge badge-group-${(row.customer_group || 'c')[0].toLowerCase()}">${row.customer_group || 'C-PIPELINE'}</span>
    </div>
</div>

<div class="section">
    <h2>Subject Property</h2>
    <table class="kv-table">
        <tr><td>Address</td><td>${row.subject_address}</td></tr>
        <tr><td>County</td><td>${county.charAt(0).toUpperCase() + county.slice(1)}</td></tr>
        <tr><td>Parcel / Property ID</td><td><a href="${subjectLink}">${row.subject_parcel_id}</a></td></tr>
        <tr><td>Current Assessed Value</td><td>$${subjectAV.toLocaleString()}</td></tr>
        <tr><td>Recommended Protest Value</td><td>$${recVal.toLocaleString()}</td></tr>
        <tr><td>Reduction</td><td>$${reduction.toLocaleString()} (${reductionPct}%)</td></tr>
        <tr><td>Tax Rate Used</td><td>${(taxRate * 100).toFixed(2)}%</td></tr>
        <tr><td>Data Source</td><td>${row.data_source}</td></tr>
        <tr><td>Subject Verified in CAD</td><td>${row.subject_verified ? '✅ Yes' : '❌ No'}</td></tr>
    </table>
</div>

<div class="savings-box">
    <div style="font-size:12px; color:#666;">Estimated Annual Tax Savings</div>
    <div class="amount">${savings > 0 ? '$' + savings.toLocaleString() + '/yr' : '$0 — No reduction found'}</div>
    ${oldSavings > 0 ? `<div style="font-size:11px; color:#999; margin-top:4px;">Previous (unverified): $${oldSavings.toLocaleString()}/yr | Change: ${row.savings_change > 0 ? '+' : ''}$${(parseFloat(row.savings_change) || 0).toLocaleString()}</div>` : ''}
</div>

<div class="section">
    <h2>Comparable Properties (Top 5 of ${row.evidence_comps_count || comps.length})</h2>
    <table>
        <thead>
            <tr>
                <th>#</th>
                <th>Address</th>
                <th>Parcel ID</th>
                <th>Assessed Value</th>
                <th>Score</th>
                <th>Source Link</th>
            </tr>
        </thead>
        <tbody>
            ${comps.map((c, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${c.address}</td>
                <td>${c.parcelId}</td>
                <td>$${(c.assessedValue || 0).toLocaleString()}</td>
                <td>${c.score || '—'}/100</td>
                <td><a href="${getSourceLink(county, c.parcelId)}">View</a></td>
            </tr>`).join('')}
        </tbody>
    </table>
</div>

<div class="section">
    <h2>Analysis Summary</h2>
    <p>${row.methodology || 'No methodology recorded.'}</p>
    <p style="margin-top:8px;"><strong>Total comps evaluated:</strong> ${row.total_comps_found || 'N/A'} | <strong>Lower than subject:</strong> ${row.total_lower_comps || 0} | <strong>Evidence comps:</strong> ${row.evidence_comps_count || comps.length}</p>
</div>

${confidence.flags.length > 0 ? `
<div class="section">
    <h2>Review Flags</h2>
    <div class="flags">
        <ul>
            ${confidence.flags.map(f => `<li>${f}</li>`).join('\n            ')}
        </ul>
    </div>
</div>
` : ''}

<div class="footer">
    <strong>INTERNAL REVIEW ONLY</strong> — This document is for Tyler Worthey's review. Do not distribute to customers.<br>
    Engine version: ${row.engine_version} | Analysis timestamp: ${row.analysis_timestamp || 'N/A'}
</div>
</body>
</html>`;
}

(async () => {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const { rows } = await pool.query(`
        SELECT * FROM analysis_verified_v1 
        WHERE status = 'VERIFIED' 
        ORDER BY 
            CASE customer_group WHEN 'A-SIGNED' THEN 1 WHEN 'B-RESULTS_SENT' THEN 2 ELSE 3 END,
            case_id
    `);

    console.log(`Generating PDFs for ${rows.length} verified cases...`);

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

    const results = [];

    for (const row of rows) {
        const confidence = assessConfidence(row);
        const html = generateHTML(row, confidence);
        const htmlPath = path.join(OUTPUT_DIR, `${row.case_id}_review.html`);
        const pdfPath = path.join(OUTPUT_DIR, `${row.case_id}_review.pdf`);

        fs.writeFileSync(htmlPath, html);

        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        await page.pdf({
            path: pdfPath,
            format: 'Letter',
            printBackground: true,
            margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' }
        });
        await page.close();

        // Update DB with confidence
        await pool.query(`UPDATE analysis_verified_v1 SET confidence_level = $1, review_flags = $2 WHERE case_id = $3 AND status = 'VERIFIED'`,
            [confidence.level, confidence.flags.join(' | '), row.case_id]);

        const savings = parseFloat(row.estimated_savings) || 0;
        results.push({
            caseId: row.case_id,
            group: row.customer_group,
            address: row.subject_address,
            county: row.subject_county,
            pid: row.subject_parcel_id,
            assessedValue: parseFloat(row.subject_assessed_value),
            recommendedValue: parseFloat(row.recommended_value) || parseFloat(row.subject_assessed_value),
            savings,
            oldSavings: parseFloat(row.old_savings) || 0,
            confidence: confidence.level,
            flags: confidence.flags,
            comps: (row.comp_details || []).length,
            pdfPath
        });

        console.log(`✅ ${row.case_id} | ${confidence.level} | $${savings}/yr | ${pdfPath}`);
    }

    await browser.close();
    await pool.end();

    // Write summary
    fs.writeFileSync(path.join(OUTPUT_DIR, 'REVIEW_MANIFEST.json'), JSON.stringify(results, null, 2));
    console.log(`\n✅ Generated ${results.length} PDFs in ${OUTPUT_DIR}`);

    // Print summary table
    console.log('\n=== REVIEW SUMMARY ===');
    console.log('Group | Case ID | Confidence | Savings | Old Savings | Flags');
    for (const r of results) {
        console.log(`${r.group} | ${r.caseId} | ${r.confidence} | $${r.savings}/yr | $${r.oldSavings}/yr | ${r.flags.length > 0 ? r.flags[0].substring(0, 60) : 'None'}`);
    }
})().catch(e => { console.error(e); process.exit(1); });
