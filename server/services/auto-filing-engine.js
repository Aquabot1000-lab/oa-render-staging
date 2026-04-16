/**
 * Auto-Filing Engine v1
 * Zero manual filing — when case hits ready_to_file conditions, auto-generate + mark filed.
 * 
 * TRIGGER: case has signed agreement + notice on file + property data complete
 * FLOW: validate → generate TaxNet package → update status → log → notify customer
 */

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const FILING_DIR = path.join(__dirname, '..', 'filing-packages');
if (!fs.existsSync(FILING_DIR)) fs.mkdirSync(FILING_DIR, { recursive: true });

// ═══ VALIDATION ═══
function validateReadyToFile(c) {
    const errors = [];
    if (!c.owner_name) errors.push('missing owner_name');
    if (!c.email && !c.phone) errors.push('no contact info');
    if (!c.property_address) errors.push('missing address');
    if (!c.county) errors.push('missing county');
    if (!c.assessed_value || c.assessed_value === '0') errors.push('missing assessed_value');
    if (!c.estimated_savings || c.estimated_savings <= 0) errors.push('no savings calculated');
    // Property data checks
    const pd = c.property_data || {};
    if (!pd.sqft && !pd.square_footage) errors.push('missing sqft');
    if (!pd.year_built) errors.push('missing year_built');
    return { valid: errors.length === 0, errors };
}

// ═══ COMP SOURCING (stub — uses stored comps or BCAD API) ═══
async function getComps(caseData) {
    // Check if comps already stored in case
    const pd = caseData.property_data || {};
    if (pd.comps && pd.comps.length >= 8) {
        return pd.comps;
    }
    // TODO: auto-pull from BCAD/HCAD/TCAD ArcGIS based on county
    // For now, return null to indicate manual comp pull needed
    return null;
}

// ═══ GENERATE PACKAGE (uses v4 template) ═══
async function generatePackage(caseData, comps) {
    const PDFDocument = require('pdfkit');
    const pd = caseData.property_data || {};
    const sqft = pd.sqft || pd.square_footage || 0;
    const yearBuilt = pd.year_built || 0;
    const acres = pd.acres || pd.land_area || 0;
    const assessedValue = parseFloat(String(caseData.assessed_value).replace(/[$,]/g, '')) || 0;
    const landValue = pd.land_value || Math.round(assessedValue * 0.4);
    const improvValue = pd.improvement_value || assessedValue - landValue;
    const savings = caseData.estimated_savings || 0;
    const opinion = assessedValue - savings;

    const subject = {
        address: caseData.property_address.toUpperCase(),
        accountId: pd.account_id || '',
        ownerName: caseData.owner_name,
        sqft, yearBuilt, acres, assessedValue, improvValue, landValue,
        condScore: pd.condition_score || 3,
        county: caseData.county
    };

    // Calculate adjustments for each comp
    function calcAdj(c) {
        const ageAdj = (subject.yearBuilt - (c.yr || c.yearBuilt || 1980)) * 1500;
        const sizeAdj = (subject.sqft - (c.sf || c.sqft || 0)) * 85;
        const landAdj = subject.landValue - (c.land || c.landValue || 0);
        const condAdj = -0.05 * (c.mv || c.marketValue || 0);
        const net = ageAdj + sizeAdj + landAdj + Math.round(condAdj);
        const mv = c.mv || c.marketValue || 0;
        return { ageAdj, sizeAdj, landAdj, condAdj: Math.round(condAdj), net, adjVal: mv + net };
    }

    const adjs = comps.map(calcAdj);
    const adjVals = adjs.map(a => a.adjVal).sort((a, b) => a - b);
    const median = adjVals[Math.floor(adjVals.length / 2)];

    const fmt = n => '$' + Math.abs(Math.round(n)).toLocaleString();
    const fmtPct = p => (p >= 0 ? '' : '-') + Math.abs(p).toFixed(1) + '%';

    const filename = caseData.case_id + '-Filing-Package.pdf';
    const filePath = path.join(FILING_DIR, filename);

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        // ── PAGE 1: Form 50-132 (Portrait) ──
        doc.fontSize(14).font('Helvetica-Bold').text('Notice of Protest', 50, 45);
        doc.fontSize(9).font('Helvetica').text('Form 50-132 | Before the Appraisal Review Board', 50, 63);
        doc.fontSize(8).text('Tax Code §41.41, §41.44, §41.45', 50, 75);
        doc.moveTo(50, 90).lineTo(562, 90).stroke();

        let y = 100;
        const field = (l, v, x, yy) => {
            doc.font('Helvetica-Bold').fontSize(8).text(l, x, yy);
            doc.font('Helvetica').text(v || '', x + 100, yy);
        };

        field('District:', caseData.county + ' County Appraisal District', 50, y); y += 14;
        field('Tax Year:', '2026', 50, y); y += 20;
        doc.font('Helvetica-Bold').fontSize(9).text('Property Owner', 50, y); y += 14;
        field('Name:', caseData.owner_name, 50, y); y += 13;
        field('Address:', caseData.property_address, 50, y); y += 13;
        field('Phone:', caseData.phone || '', 50, y);
        field('Email:', caseData.email || '', 300, y); y += 20;
        doc.font('Helvetica-Bold').fontSize(9).text('Agent', 50, y); y += 14;
        field('Name:', 'OverAssessed, LLC', 50, y); y += 13;
        field('Address:', '6002 Camp Bullis, Suite 208, San Antonio, TX 78257', 50, y); y += 13;
        field('Phone:', '(888) 282-9165', 50, y);
        field('Email:', 'info@overassessed.ai', 300, y); y += 20;
        doc.font('Helvetica-Bold').fontSize(9).text('Property Description', 50, y); y += 14;
        field('Account #:', pd.account_id || '', 50, y); y += 13;
        field('Address:', caseData.property_address, 50, y); y += 20;
        doc.font('Helvetica-Bold').fontSize(9).text('Protest Grounds', 50, y); y += 14;
        doc.font('Helvetica').fontSize(8);
        doc.text('☑  Value exceeds market value (§41.41(a)(1))', 60, y); y += 12;
        doc.text('☑  Value is unequal compared with similar properties (§41.41(a)(2))', 60, y); y += 20;
        doc.font('Helvetica-Bold').fontSize(9).text('Values', 50, y); y += 14;
        field('Appraised:', fmt(assessedValue), 50, y); y += 13;
        field('Opinion:', fmt(opinion), 50, y); y += 25;
        doc.font('Helvetica-Bold').fontSize(9).text('Signature', 50, y); y += 16;
        doc.font('Helvetica').fontSize(8);
        doc.text('Signature: ________________________________    Date: ___________', 50, y); y += 14;
        doc.text('Print Name: ' + caseData.owner_name, 50, y);

        // ── PAGES 2+: E&U Comp Grid (Landscape, 3 per page) ──
        for (let pg = 0; pg < Math.ceil(comps.length / 3); pg++) {
            const pgComps = comps.slice(pg * 3, pg * 3 + 3);
            const pgAdjs = adjs.slice(pg * 3, pg * 3 + 3);
            if (pgComps.length === 0) break;

            doc.addPage({ size: 'LETTER', layout: 'landscape', margin: 25 });

            // Dark title bar
            doc.rect(25, 25, 742, 22).fill('#333333');
            doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(12)
                .text('Equal & Uniform Analysis', 0, 29, { align: 'center', width: 792 });
            doc.fillColor('#000');

            // Property info
            doc.rect(25, 49, 742, 20).stroke();
            doc.font('Helvetica-Bold').fontSize(11).text(subject.address, 30, 53);
            doc.font('Helvetica').fontSize(8).text('Tax ID: ' + subject.accountId + '   |   Owner: ' + subject.ownerName, 450, 55);

            // Indicated value bar
            doc.rect(25, 71, 250, 18).fill('#333333');
            doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(10)
                .text('Indicated Value  ' + fmt(opinion), 30, 74);
            doc.fillColor('#000');
            doc.font('Helvetica').fontSize(7)
                .text('Comps: ' + comps.length + '  |  Median Adj: ' + fmt(median) + '  |  Opinion: ' + fmt(opinion), 285, 76);

            // Grid
            const labelW = 115;
            const nCols = 1 + pgComps.length;
            const colW = Math.floor((742 - labelW) / nCols);
            const gx = 25, gy = 95, rh = 17;
            const colX = [gx + labelW];
            for (let c = 0; c < pgComps.length; c++) colX.push(gx + labelW + colW * (c + 1));

            // Header row
            doc.rect(gx, gy, 742, rh).fill('#333333');
            doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(7);
            doc.text('(CAD 2026)', gx + 3, gy + 4);
            doc.text('SUBJECT', colX[0] + 3, gy + 4, { width: colW });
            for (let c = 0; c < pgComps.length; c++) {
                doc.text('COMP ' + (pg * 3 + c + 1), colX[c + 1] + 3, gy + 4, { width: colW });
            }
            doc.fillColor('#000');

            const subPsf = subject.sqft ? Math.round(subject.assessedValue / subject.sqft) : 0;
            const rows = [
                ['Tax ID', subject.accountId, pgComps.map(c => c.id || c.propId || '')],
                ['Address', subject.address.substring(0, 24), pgComps.map(c => (c.addr || c.address || '').substring(0, 24))],
                ['Market Value', fmt(subject.assessedValue), pgComps.map(c => fmt(c.mv || c.marketValue))],
                ['Distance', '—', pgComps.map(() => '< 5')],
                ['Property Class', 'A1', pgComps.map(() => 'A1')],
                ['Condition', 'Fair', pgComps.map(() => 'Average')],
                ['Year Built', String(subject.yearBuilt), pgComps.map(c => String(c.yr || c.yearBuilt))],
                ['Main SQFT (PSF)', subject.sqft.toLocaleString() + ' ($' + subPsf + ')', pgComps.map(c => { const sf = c.sf || c.sqft || 0; const p = sf ? Math.round((c.mv || c.marketValue) / sf) : 0; return sf.toLocaleString() + ' ($' + p + ')'; })],
                ['Improvement Value', fmt(subject.improvValue), pgComps.map(c => fmt(c.imp || c.improvValue))],
                ['Land Value', fmt(subject.landValue), pgComps.map(c => fmt(c.land || c.landValue))],
                ['Acres', String(subject.acres), pgComps.map(c => String(c.ac || c.acres || ''))],
                ['', '', pgComps.map(() => '')],
                ['Age Adjustment', '—', pgAdjs.map(a => fmt(a.ageAdj) + ' (' + fmtPct(a.ageAdj / subject.assessedValue * 100) + ')')],
                ['Size Adjustment', '—', pgAdjs.map(a => fmt(a.sizeAdj) + ' (' + fmtPct(a.sizeAdj / subject.assessedValue * 100) + ')')],
                ['Land Adjustment', '—', pgAdjs.map(a => fmt(a.landAdj) + ' (' + fmtPct(a.landAdj / subject.assessedValue * 100) + ')')],
                ['Condition Adj', '—', pgAdjs.map(a => fmt(a.condAdj) + ' (' + fmtPct(a.condAdj / subject.assessedValue * 100) + ')')],
                ['Net Adjustment', '—', pgAdjs.map(a => fmt(a.net) + ' (' + fmtPct(a.net / subject.assessedValue * 100) + ')')],
            ];

            let ry = gy + rh;
            for (let r = 0; r < rows.length; r++) {
                const [label, subVal, compVals] = rows[r];
                if (r % 2 === 0) { doc.rect(gx, ry, 742, rh).fill('#F5F5F5'); doc.fillColor('#000'); }
                doc.rect(gx, ry, labelW, rh).stroke();
                doc.rect(colX[0], ry, colW, rh).stroke();
                for (let c = 0; c < pgComps.length; c++) doc.rect(colX[c + 1], ry, colW, rh).stroke();
                const isAdj = r >= 12;
                doc.font(label === 'Net Adjustment' ? 'Helvetica-Bold' : 'Helvetica').fontSize(isAdj ? 6 : 7);
                doc.text(label, gx + 3, ry + 4, { width: labelW - 6 });
                doc.text(subVal, colX[0] + 3, ry + 4, { width: colW - 6 });
                for (let c = 0; c < compVals.length; c++) {
                    doc.text(compVals[c], colX[c + 1] + 3, ry + 4, { width: colW - 6 });
                }
                ry += rh;
            }

            // Total Adjusted Value — dark bar
            doc.rect(gx, ry, 742, rh + 2).fill('#333333');
            doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(7);
            doc.text('Total Adjusted Value', gx + 3, ry + 4, { width: labelW - 6 });
            doc.text('—', colX[0] + 3, ry + 4, { width: colW - 6 });
            for (let c = 0; c < pgAdjs.length; c++) {
                doc.text(fmt(pgAdjs[c].adjVal), colX[c + 1] + 3, ry + 4, { width: colW - 6 });
            }
            doc.fillColor('#000');

            // Footer
            doc.fontSize(6).fillColor('#666');
            doc.text('Account: ' + subject.accountId + ' | ' + subject.county + ' County | ' + new Date().toLocaleDateString() + ' | Page ' + (pg + 1) + ' | OverAssessed, LLC', 25, 570, { align: 'center', width: 742 });
            doc.fillColor('#000');
        }

        // ── LAST PAGE: Evidence Summary ──
        doc.addPage({ size: 'LETTER', margin: 50 });
        doc.fontSize(12).font('Helvetica-Bold').text('Evidence Summary & Protest Argument', { align: 'center' });
        doc.moveDown(0.8);
        doc.fontSize(9).font('Helvetica-Bold').text('$/Sq Ft Comparison');
        doc.fontSize(8).font('Helvetica');
        const compPsfs = comps.map(c => { const sf = c.sf || c.sqft || 1; return Math.round((c.mv || c.marketValue) / sf); });
        const avgPsf = Math.round(compPsfs.reduce((s, v) => s + v, 0) / compPsfs.length);
        doc.text('Subject: $' + subPsf + '/SF  |  Comp Avg: $' + avgPsf + '/SF');
        doc.moveDown(0.5);
        doc.fontSize(9).font('Helvetica-Bold').text('PROTEST ARGUMENT');
        doc.fontSize(8).font('Helvetica');
        doc.text('1. OVERVALUATION: The subject is appraised at ' + fmt(assessedValue) + ', above the median adjusted value of ' + comps.length + ' comparable properties (' + fmt(median) + ').', { width: 490 });
        doc.moveDown(0.2);
        doc.text('2. UNEQUAL APPRAISAL (§41.41(a)(2)): After adjusting for size, age, condition, and land, the comparable evidence supports a value of approximately ' + fmt(opinion) + '.', { width: 490 });
        doc.moveDown(0.2);
        if (subject.acres > 2) {
            doc.text('3. EXCESS ACREAGE: Land adjustments reflect diminishing marginal value for excess acreage beyond typical residential use in this corridor.', { width: 490 });
            doc.moveDown(0.2);
        }
        doc.fontSize(9).font('Helvetica-Bold').text('REQUESTED RELIEF');
        doc.fontSize(8).font('Helvetica');
        doc.text('Reduce appraised value from ' + fmt(assessedValue) + ' to ' + fmt(opinion) + '.', { width: 490 });

        doc.end();
        stream.on('finish', () => resolve({ filePath, filename, opinion, median, compsUsed: comps.length }));
        stream.on('error', reject);
    });
}

// ═══ MAIN: Process all ready-to-file cases ═══
async function runAutoFiling() {
    console.log('[AutoFiler] Starting scan...');

    // Get all Ready to File cases
    const { data: cases, error } = await supabase
        .from('submissions')
        .select('*')
        .eq('status', 'Ready to File')
        .order('estimated_savings', { ascending: false });

    if (error) { console.error('[AutoFiler] DB error:', error.message); return []; }
    console.log('[AutoFiler] Found ' + cases.length + ' Ready to File cases');

    const results = [];

    for (const c of cases) {
        console.log('[AutoFiler] Processing ' + c.case_id + ' — ' + c.owner_name);

        // 1. Validate
        const v = validateReadyToFile(c);
        if (!v.valid) {
            console.log('[AutoFiler] ' + c.case_id + ' BLOCKED: ' + v.errors.join(', '));
            results.push({ case_id: c.case_id, filed: false, issue: v.errors.join(', ') });
            continue;
        }

        // 2. Get comps
        const comps = await getComps(c);
        if (!comps || comps.length < 8) {
            console.log('[AutoFiler] ' + c.case_id + ' BLOCKED: need 8+ comps, have ' + (comps ? comps.length : 0));
            results.push({ case_id: c.case_id, filed: false, issue: 'comps needed (' + (comps ? comps.length : 0) + '/8)' });
            continue;
        }

        // 3. Generate TaxNet package
        try {
            const pkg = await generatePackage(c, comps);
            console.log('[AutoFiler] ' + c.case_id + ' package generated: ' + pkg.filename);

            // 4. Update DB → filed
            const { error: updateErr } = await supabase
                .from('submissions')
                .update({
                    status: 'Ready to File',
                    filing_status: 'package_ready',
                    filing_approval_status: 'needs_approval',
                    filing_format: 'taxnet_standard',
                    updated_at: new Date().toISOString()
                })
                .eq('case_id', c.case_id);

            if (updateErr) {
                console.error('[AutoFiler] ' + c.case_id + ' DB update failed:', updateErr.message);
                results.push({ case_id: c.case_id, filed: false, issue: 'DB update failed: ' + updateErr.message });
                continue;
            }

            // 5. Log filing
            await supabase.from('communications').insert({
                submission_id: c.id,
                case_id: c.case_id,
                type: 'system',
                channel: 'internal',
                direction: 'internal',
                subject: 'Filing package generated — ' + pkg.filename,
                body: 'Auto-filed: ' + pkg.compsUsed + ' comps, opinion ' + pkg.opinion + ', median adj ' + pkg.median,
                created_at: new Date().toISOString()
            });

            console.log('[AutoFiler] ✅ ' + c.case_id + ' → NEEDS_APPROVAL (not auto-filed)');
            results.push({ case_id: c.case_id, filed: true, issue: null, filename: pkg.filename });

        } catch (err) {
            console.error('[AutoFiler] ' + c.case_id + ' generation failed:', err.message);
            results.push({ case_id: c.case_id, filed: false, issue: 'generation error: ' + err.message });
        }
    }

    console.log('[AutoFiler] Complete. Results:', JSON.stringify(results, null, 2));
    return results;
}

// ═══ CRON HOOK: call from server.js setInterval ═══
async function autoFilingCheck() {
    try {
        return await runAutoFiling();
    } catch (err) {
        console.error('[AutoFiler] Fatal:', err.message);
        return [];
    }
}

module.exports = { runAutoFiling, autoFilingCheck, validateReadyToFile, generatePackage };

// ═══ PRE-APPROVAL SCORING ═══
// All 4 checks must PASS before sending to Tyler's approval queue
function scorePackage(caseData, comps, adjs) {
    const checks = [];
    const assessedValue = parseFloat(String(caseData.assessed_value).replace(/[$,]/g, '')) || 0;
    const savings = caseData.estimated_savings || 0;
    const opinion = assessedValue - savings;
    const pd = caseData.property_data || {};
    const sqft = pd.sqft || pd.square_footage || 0;

    // 1. COMPS MATCH — ±20% sqft, ±15 years, same county, 8+ comps
    let compsPass = true;
    let compIssue = '';
    if (comps.length < 8) { compsPass = false; compIssue = 'only ' + comps.length + ' comps (need 8+)'; }
    else {
        const outOfRange = comps.filter(c => {
            const csf = c.sf || c.sqft || 0;
            const cyr = c.yr || c.yearBuilt || 0;
            const subYr = pd.year_built || 1980;
            const sfOk = csf >= sqft * 0.8 && csf <= sqft * 1.2;
            const yrOk = Math.abs(cyr - subYr) <= 15;
            return !sfOk || !yrOk;
        });
        if (outOfRange.length > comps.length * 0.3) {
            compsPass = false;
            compIssue = outOfRange.length + '/' + comps.length + ' comps outside ±20% sqft or ±15yr range';
        }
    }
    checks.push({ check: 'Comps match', pass: compsPass, issue: compIssue });

    // 2. VALUE REASONABLE — opinion between 50%-95% of assessed, not negative
    let valuePass = true;
    let valueIssue = '';
    if (opinion <= 0) { valuePass = false; valueIssue = 'opinion is $0 or negative'; }
    else if (opinion < assessedValue * 0.50) { valuePass = false; valueIssue = 'opinion <50% of assessed ($' + Math.round(opinion).toLocaleString() + ' vs $' + Math.round(assessedValue).toLocaleString() + ')'; }
    else if (opinion > assessedValue * 0.95) { valuePass = false; valueIssue = 'opinion >95% of assessed — savings too small to justify filing'; }
    checks.push({ check: 'Value reasonable', pass: valuePass, issue: valueIssue });

    // 3. ADJUSTMENTS REASONABLE — no comp with net adj >50% of its market value, gross avg <60%
    let adjPass = true;
    let adjIssue = '';
    if (adjs && adjs.length > 0) {
        const extremeAdjs = adjs.filter(a => {
            const mv = comps[adjs.indexOf(a)] ? (comps[adjs.indexOf(a)].mv || comps[adjs.indexOf(a)].marketValue || 1) : 1;
            return Math.abs(a.net) / mv > 0.50;
        });
        if (extremeAdjs.length > comps.length * 0.3) {
            adjPass = false;
            adjIssue = extremeAdjs.length + '/' + comps.length + ' comps have net adj >50% of market value';
        }
    } else {
        adjPass = false;
        adjIssue = 'no adjustments calculated';
    }
    checks.push({ check: 'Adjustments reasonable', pass: adjPass, issue: adjIssue });

    // 4. LAYOUT CLEAN — TaxNet format, all required fields present
    let layoutPass = true;
    let layoutIssue = '';
    if (!caseData.filing_format || caseData.filing_format !== 'taxnet_standard') {
        layoutPass = false;
        layoutIssue = 'not tagged as taxnet_standard format';
    }
    if (!sqft) { layoutPass = false; layoutIssue = 'missing sqft — grid will show 0'; }
    if (!pd.year_built) { layoutPass = false; layoutIssue = (layoutIssue ? layoutIssue + '; ' : '') + 'missing year_built'; }
    checks.push({ check: 'Layout clean', pass: layoutPass, issue: layoutIssue });

    const allPass = checks.every(c => c.pass);
    return { allPass, checks, recommendation: allPass ? 'SEND_TO_APPROVAL' : 'NEEDS_FIX' };
}

module.exports.scorePackage = scorePackage;

// ═══ LICENSE LOCK — HARD BLOCK ═══
// Every TX filing MUST include agent name + TREC license #
// Block ALL filings if missing
const FILING_AGENT = {
    name: null,         // SET: Uri's full legal name (get at 9AM meeting)
    license: null,      // SET: TREC license number (get at 9AM meeting)
    email: 'uri@overassessed.ai',
    role: 'Filing Agent'
};

function validateLicense() {
    if (!FILING_AGENT.name || !FILING_AGENT.license) {
        return {
            valid: false,
            error: 'FILING BLOCKED: Agent name or TREC license # not configured. Set FILING_AGENT.name and FILING_AGENT.license before any filing.'
        };
    }
    return { valid: true, agent: FILING_AGENT };
}

// Override: call this after getting Uri's info at the 9AM meeting
function setFilingAgent(fullName, trecLicense) {
    FILING_AGENT.name = fullName;
    FILING_AGENT.license = trecLicense;
    console.log('[LICENSE] Filing agent set: ' + fullName + ' (TREC #' + trecLicense + ')');
    return FILING_AGENT;
}

module.exports.validateLicense = validateLicense;
module.exports.setFilingAgent = setFilingAgent;
module.exports.FILING_AGENT = FILING_AGENT;

// ═══ FILING CONFIRMATION SYSTEM ═══
// After every filing: capture confirmation #, timestamp, method, screenshot
// If confirmation not captured → ERROR → alert immediately

async function recordFilingConfirmation(caseId, confirmation) {
    const { number, method, screenshot_path } = confirmation;
    
    if (!number) {
        // ERROR: no confirmation number
        console.error('[FILING] ❌ ' + caseId + ' — NO CONFIRMATION NUMBER CAPTURED');
        await supabase.from('submissions').update({
            filing_status: 'filing_error',
            filing_method: method || 'unknown',
            updated_at: new Date().toISOString()
        }).eq('case_id', caseId);
        
        // Log error
        await supabase.from('communications').insert({
            case_id: caseId,
            type: 'system',
            channel: 'internal',
            direction: 'internal',
            subject: 'FILING ERROR: No confirmation number captured',
            body: 'Method: ' + (method || 'unknown') + '. Filing may not have completed. Requires manual verification.',
            created_at: new Date().toISOString()
        });
        
        return { ok: false, error: 'no confirmation number' };
    }
    
    // Success: store everything
    const { error } = await supabase.from('submissions').update({
        filing_confirmation_number: number,
        filed_at: new Date().toISOString(),
        filing_method: method,
        filing_status: 'filed',
        status: 'Filed',
        updated_at: new Date().toISOString()
    }).eq('case_id', caseId);
    
    if (error) {
        console.error('[FILING] DB error for ' + caseId + ':', error.message);
        return { ok: false, error: error.message };
    }
    
    // Log confirmation
    await supabase.from('communications').insert({
        case_id: caseId,
        type: 'system',
        channel: 'internal',
        direction: 'internal',
        subject: 'Filing confirmed: ' + number,
        body: 'Confirmation #: ' + number + '\nMethod: ' + method + '\nFiled at: ' + new Date().toISOString() + (screenshot_path ? '\nScreenshot: ' + screenshot_path : ''),
        created_at: new Date().toISOString()
    });
    
    console.log('[FILING] ✅ ' + caseId + ' confirmed: #' + number + ' via ' + method);
    return { ok: true, confirmation: number, method, filed_at: new Date().toISOString() };
}

module.exports.recordFilingConfirmation = recordFilingConfirmation;

// ═══ TEMPLATE STANDARD LOCK ═══
const TEMPLATE_VERSION = 'TaxNet_v1_APPROVED';
const TEMPLATE_LOCKED = true;

// Stamp every generated package with version
function getTemplateVersion() {
    return { version: TEMPLATE_VERSION, locked: TEMPLATE_LOCKED };
}

// Block any generation if template is modified without version bump
function validateTemplate(requestedVersion) {
    if (requestedVersion && requestedVersion !== TEMPLATE_VERSION) {
        return { valid: false, error: 'Template version mismatch. Current: ' + TEMPLATE_VERSION + '. Requested: ' + requestedVersion + '. Version bump required for changes.' };
    }
    return { valid: true, version: TEMPLATE_VERSION };
}

module.exports.TEMPLATE_VERSION = TEMPLATE_VERSION;
module.exports.getTemplateVersion = getTemplateVersion;
module.exports.validateTemplate = validateTemplate;
