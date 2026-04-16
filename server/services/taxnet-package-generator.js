/**
 * TaxNet USA Standard Filing Package Generator v3
 * Matches IntegraTax/TaxNet Equal & Uniform Analysis format exactly.
 * 
 * Grid columns: Tax ID, Address, Market Value, Distance, Property Class,
 * Condition, Year Built (Effective), Main SQFT (PSF), Improvement Value,
 * Land Value, Age Adj, Size Adj, Land Adj, Condition Adj, Net Adjustment,
 * Total Adjusted Value — each with $ + %
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const FILING_DIR = path.join(__dirname, '..', 'filing-packages');
if (!fs.existsSync(FILING_DIR)) fs.mkdirSync(FILING_DIR, { recursive: true });

const AGENT_INFO = {
    name: 'OverAssessed, LLC',
    address: '6002 Camp Bullis, Suite 208, San Antonio, TX 78257',
    phone: '(888) 282-9165',
    email: 'info@overassessed.ai'
};

function fmt(n) { return '$' + Math.abs(Math.round(n)).toLocaleString(); }
function fmtAdj(dollar, pct) {
    const d = Math.round(dollar);
    const p = (Math.round(pct * 100) / 100).toFixed(2);
    const prefix = d >= 0 ? '$' : '$-';
    const val = Math.abs(d).toLocaleString();
    const pPrefix = parseFloat(p) >= 0 ? '' : '-';
    return `${prefix}${val} (${pPrefix}${Math.abs(parseFloat(p)).toFixed(2)}%)`;
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''; }

/**
 * Calculate E&U adjustments (TaxNet method)
 * Adjustments are added TO the comp to make it equivalent to the subject.
 */
function calcAdjustments(comp, subject) {
    const mv = comp.marketValue || 0;
    
    // Age adjustment: (subject effective year - comp effective year) * rate
    const subEff = subject.effectiveYear || subject.yearBuilt || 1980;
    const compEff = comp.effectiveYear || comp.yearBuilt || 1980;
    const ageDiff = subEff - compEff; // positive = subject newer = comp gets + adj
    const ageAdj = ageDiff * 1500;
    const agePct = mv ? (ageAdj / mv) * 100 : 0;
    
    // Size adjustment: (subject sqft - comp sqft) * $/sqft rate
    const sizeDiff = (subject.sqft || 0) - (comp.sqft || 0);
    const sizeRate = 85;
    const sizeAdj = sizeDiff * sizeRate;
    const sizePct = mv ? (sizeAdj / mv) * 100 : 0;
    
    // Land adjustment: (subject land value - comp land value)
    const subLand = subject.landValue || 0;
    const compLand = comp.landValue || 0;
    const landAdj = subLand - compLand;
    const landPct = mv ? (landAdj / mv) * 100 : 0;
    
    // Condition adjustment: subject is Fair (2), comps assumed Average (3)
    const subCond = subject.conditionScore || 2;
    const compCond = comp.conditionScore || 3;
    const condDiff = subCond - compCond; // negative = subject worse
    const condAdj = condDiff * 0.05 * mv;
    const condPct = mv ? (condAdj / mv) * 100 : 0;
    
    const netAdj = ageAdj + sizeAdj + landAdj + condAdj;
    const netPct = mv ? (netAdj / mv) * 100 : 0;
    const adjValue = mv + netAdj;
    
    // Gross % = sum of absolute adjustments / mv
    const grossAdj = Math.abs(ageAdj) + Math.abs(sizeAdj) + Math.abs(landAdj) + Math.abs(condAdj);
    const grossPct = mv ? (grossAdj / mv) * 100 : 0;
    
    return {
        ageAdj, agePct, sizeAdj, sizePct, landAdj, landPct,
        condAdj: Math.round(condAdj), condPct,
        netAdj: Math.round(netAdj), netPct,
        grossAdj: Math.round(grossAdj), grossPct,
        adjustedValue: Math.round(adjValue)
    };
}

function validatePackage(comps, subject) {
    const errors = [];
    if (comps.length < 8) errors.push('Need 8+ comps, have ' + comps.length);
    if (!subject.sqft) errors.push('Subject sqft missing');
    if (!subject.assessedValue) errors.push('Subject assessed value missing');
    for (let i = 0; i < comps.length; i++) {
        if (!comps[i].marketValue) errors.push('Comp ' + (i+1) + ' missing market value');
        if (!comps[i].sqft) errors.push('Comp ' + (i+1) + ' missing sqft');
    }
    return { valid: errors.length === 0, errors };
}

// ── PAGE: Form 50-132 ──
function renderForm50132(doc, caseData, property) {
    doc.fontSize(9).font('Helvetica').text('Form 50-132', 450, 50, { align: 'right' });
    doc.fontSize(14).font('Helvetica-Bold').text('Notice of Protest', 50, 50, { width: 400 });
    doc.fontSize(10).font('Helvetica').text('Before the Appraisal Review Board', 50, 68);
    doc.fontSize(9).text('Tax Code Sections 41.41, 41.44, 41.45', 50, 80);
    
    let y = 100;
    const fl = (lbl, val, x, yy) => {
        doc.font('Helvetica-Bold').fontSize(8).text(lbl, x, yy, { continued: true });
        doc.font('Helvetica').text(' ' + (val || ''));
    };
    
    doc.font('Helvetica-Bold').fontSize(9).text('STEP 1: Appraisal District', 50, y); y += 14;
    fl('District:', cap(caseData.county) + ' County Appraisal District', 50, y); y += 12;
    fl('Tax Year:', '2026', 50, y); y += 18;
    
    doc.font('Helvetica-Bold').fontSize(9).text('STEP 2: Owner / Agent', 50, y); y += 14;
    fl('Owner:', caseData.owner_name, 50, y); y += 12;
    fl('Address:', caseData.property_address, 50, y); y += 12;
    fl('Phone:', caseData.phone || '', 50, y); fl('Email:', caseData.email || '', 300, y); y += 12;
    fl('Agent:', AGENT_INFO.name, 50, y); y += 12;
    fl('Agent Addr:', AGENT_INFO.address, 50, y); y += 12;
    fl('Agent Phone:', AGENT_INFO.phone, 50, y); fl('Agent Email:', AGENT_INFO.email, 300, y); y += 18;
    
    doc.font('Helvetica-Bold').fontSize(9).text('STEP 3: Property', 50, y); y += 14;
    fl('Account #:', property.accountId || '', 50, y); fl('Geo ID:', property.geoId || '', 300, y); y += 12;
    fl('Address:', caseData.property_address, 50, y); y += 12;
    fl('Legal:', (property.legalDescription || '').substring(0, 90), 50, y); y += 18;
    
    doc.font('Helvetica-Bold').fontSize(9).text('STEP 4: Protest Grounds', 50, y); y += 14;
    doc.font('Helvetica').fontSize(8);
    doc.text('☑  Value exceeds market value (§41.41(a)(1))', 60, y); y += 12;
    doc.text('☑  Value is unequal compared with similar properties (§41.41(a)(2))', 60, y); y += 18;
    
    doc.font('Helvetica-Bold').fontSize(9).text('STEP 5: Values', 50, y); y += 14;
    fl('District Appraised:', '$' + (property.assessedValue || 0).toLocaleString(), 50, y); y += 12;
    fl('Owner Opinion:', '$' + (property.opinionOfValue || 0).toLocaleString(), 50, y); y += 22;
    
    doc.font('Helvetica-Bold').fontSize(9).text('STEP 6: Signature', 50, y); y += 16;
    doc.font('Helvetica').fontSize(8);
    doc.text('Signature: ________________________________    Date: ___________', 50, y); y += 14;
    doc.text('Print Name: ' + caseData.owner_name, 50, y);
    
    doc.fontSize(7).fillColor('#666');
    doc.text('Texas Comptroller Form 50-132 — TaxNet USA Standard', 50, 720, { align: 'center', width: 500 });
    doc.fillColor('#000');
}

// ── PAGE(S): E&U Comp Grid (TaxNet format) ──
function renderEUGrid(doc, subject, comps, allAdj) {
    // 3 comps per page (vertical column layout like TaxNet)
    const pages = [];
    for (let i = 0; i < comps.length; i += 3) {
        pages.push(comps.slice(i, i + 3));
    }
    
    const adjValues = allAdj.map(a => a.adjustedValue);
    adjValues.sort((a, b) => a - b);
    const medianVal = adjValues[Math.floor(adjValues.length / 2)];
    const minVal = adjValues[0];
    const maxVal = adjValues[adjValues.length - 1];
    
    for (let pg = 0; pg < pages.length; pg++) {
        doc.addPage({ size: 'LETTER', margin: 30 });
        const pageComps = pages[pg];
        const pageAdjs = [];
        for (let k = 0; k < pageComps.length; k++) {
            const idx = pg * 3 + k;
            pageAdjs.push(allAdj[idx]);
        }
        
        // Header bar
        doc.rect(28, 28, 556, 18).fill('#2C3E50');
        doc.fillColor('#FFF').fontSize(10).font('Helvetica-Bold');
        doc.text('Equal & Uniform Analysis', 0, 32, { align: 'center', width: 612 });
        doc.fillColor('#000');
        
        // Sub-header
        doc.fontSize(10).font('Helvetica-Bold').text(subject.address.toUpperCase(), 30, 52);
        doc.fontSize(8).font('Helvetica');
        doc.text('Tax ID: ' + (subject.accountId || ''), 400, 52);
        doc.text('Owner: ' + (subject.ownerName || ''), 400, 62);
        
        // Indicated value box
        doc.rect(30, 76, 180, 16).fill('#E8E8E8');
        doc.fillColor('#000').font('Helvetica-Bold').fontSize(9);
        doc.text('Indicated Value ' + fmt(medianVal), 35, 79);
        doc.font('Helvetica').fontSize(7);
        doc.text('Comps: ' + comps.length + ' | Min: ' + fmt(minVal) + ' | Max: ' + fmt(maxVal) + ' | Median: ' + fmt(medianVal), 220, 80, { width: 350 });
        
        // Account + county footer info
        doc.fontSize(6).fillColor('#666');
        doc.text(cap(subject.county || 'Bexar') + ' County | Page ' + (pg + 1) + ' of ' + pages.length + ' | ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), 30, 750, { width: 550, align: 'center' });
        doc.text('Prepared by: OverAssessed, LLC | TaxNet USA Standard', 30, 758, { width: 550, align: 'center' });
        doc.fillColor('#000');
        
        // Column layout: row labels on left, then SUBJECT col, then comp cols
        const leftW = 120;
        const colW = Math.floor((556 - leftW) / (1 + pageComps.length));
        const startX = 30;
        const colX = [startX + leftW]; // subject column
        for (let c = 0; c < pageComps.length; c++) {
            colX.push(startX + leftW + colW * (c + 1));
        }
        
        let y = 98;
        const rowH = 14;
        
        // Column headers
        doc.rect(startX, y, 556, rowH).fill('#34495E');
        doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(7);
        doc.text('(CAD 2026)', startX + 2, y + 3);
        doc.text('SUBJECT', colX[0], y + 3, { width: colW });
        for (let c = 0; c < pageComps.length; c++) {
            const compNum = pg * 3 + c + 1;
            doc.text('COMP ' + compNum, colX[c + 1], y + 3, { width: colW });
        }
        doc.fillColor('#000');
        y += rowH;
        
        // Row definitions
        const subPsf = subject.sqft ? Math.round(subject.assessedValue / subject.sqft) : 0;
        
        const rows = [
            { label: 'Tax ID', subject: subject.accountId || '', comps: pageComps.map(c => c.propId || '') },
            { label: 'Address', subject: subject.address.substring(0, 22), comps: pageComps.map(c => (c.address || '').substring(0, 22)) },
            { label: 'Market Value', subject: fmt(subject.assessedValue), comps: pageComps.map(c => fmt(c.marketValue)) },
            { label: 'Distance (Miles)', subject: '—', comps: pageComps.map(c => c.distance ? c.distance.toFixed(2) : '—') },
            { label: 'Property Class', subject: subject.propClass || 'A1', comps: pageComps.map(c => c.propClass || 'A1') },
            { label: 'Condition', subject: subject.conditionLabel || 'Fair', comps: pageComps.map(c => c.conditionLabel || 'Average') },
            { label: 'Year Built (Effective)', subject: (subject.yearBuilt || '—') + (subject.effectiveYear ? ' (' + subject.effectiveYear + ')' : ''), comps: pageComps.map(c => (c.yearBuilt || '—') + (c.effectiveYear ? ' (' + c.effectiveYear + ')' : '')) },
            { label: 'Main SQFT (PSF)', subject: (subject.sqft || 0).toLocaleString() + ' ($' + subPsf + ')', comps: pageComps.map(c => { const psf = c.sqft ? Math.round((c.marketValue - (c.landValue||0)) / c.sqft) : 0; return (c.sqft||0).toLocaleString() + ' ($' + psf + ')'; }) },
            { label: 'Improvement Value', subject: fmt(subject.improvementValue || 0), comps: pageComps.map(c => fmt(c.improvValue || 0)) },
            { label: 'Land Value', subject: fmt(subject.landValue || 0), comps: pageComps.map(c => fmt(c.landValue || 0)) },
            { label: 'Acres', subject: String(subject.acres || '—'), comps: pageComps.map(c => String(c.acres || '—')) },
            { label: '', subject: '', comps: pageComps.map(() => '') }, // spacer
            { label: 'Age Adjustment', subject: '—', comps: pageAdjs.map(a => fmtAdj(a.ageAdj, a.agePct)), isAdj: true },
            { label: 'Size Adjustment', subject: '—', comps: pageAdjs.map(a => fmtAdj(a.sizeAdj, a.sizePct)), isAdj: true },
            { label: 'Land Adjustment', subject: '—', comps: pageAdjs.map(a => fmtAdj(a.landAdj, a.landPct)), isAdj: true },
            { label: 'Condition Adjustment', subject: '—', comps: pageAdjs.map(a => fmtAdj(a.condAdj, a.condPct)), isAdj: true },
            { label: 'Net Adjustment', subject: '—', comps: pageAdjs.map(a => fmtAdj(a.netAdj, a.netPct)), isAdj: true, bold: true },
            { label: 'Total Adjusted Value', subject: '—', comps: pageAdjs.map(a => fmt(a.adjustedValue)), bold: true, highlight: true },
        ];
        
        for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            if (r % 2 === 0 && !row.highlight) {
                doc.rect(startX, y - 1, 556, rowH).fill('#F8F9FA');
                doc.fillColor('#000');
            }
            if (row.highlight) {
                doc.rect(startX, y - 1, 556, rowH).fill('#D5F5E3');
                doc.fillColor('#000');
            }
            
            const font = row.bold ? 'Helvetica-Bold' : 'Helvetica';
            const sz = row.isAdj ? 6.5 : 7;
            doc.font(row.label ? 'Helvetica-Bold' : 'Helvetica').fontSize(7).text(row.label, startX + 2, y + 2, { width: leftW - 4 });
            doc.font(font).fontSize(sz).text(row.subject, colX[0], y + 2, { width: colW - 2 });
            for (let c = 0; c < row.comps.length; c++) {
                doc.font(font).fontSize(sz).text(row.comps[c], colX[c + 1], y + 2, { width: colW - 2 });
            }
            y += rowH;
        }
    }
    
    return { median: medianVal, min: minVal, max: maxVal, adjValues };
}

// ── PAGE: Evidence Summary ──
function renderEvidence(doc, caseData, subject, comps, allAdj, stats) {
    doc.addPage({ size: 'LETTER', margin: 50 });
    
    doc.fontSize(12).font('Helvetica-Bold').text('Evidence Summary & Protest Argument', { align: 'center' });
    doc.fontSize(8).font('Helvetica').text('TaxNet USA Standard — Supporting Documentation', { align: 'center' });
    doc.moveDown(0.8);
    
    // $/sqft comparison
    doc.fontSize(10).font('Helvetica-Bold').text('$/Sq Ft Comparison');
    doc.moveDown(0.3);
    doc.fontSize(8).font('Helvetica');
    const subPsf = subject.sqft ? Math.round(subject.assessedValue / subject.sqft) : 0;
    const compPsfs = comps.filter(c => c.sqft > 0).map(c => Math.round(c.marketValue / c.sqft));
    const avgPsf = Math.round(compPsfs.reduce((s,v) => s+v, 0) / compPsfs.length);
    const medPsf = compPsfs.sort((a,b)=>a-b)[Math.floor(compPsfs.length/2)];
    
    doc.text('Subject $/SF: $' + subPsf + ' (appraised $' + subject.assessedValue.toLocaleString() + ' / ' + subject.sqft + ' SF)');
    doc.text('Comp Average $/SF: $' + avgPsf + '  |  Comp Median $/SF: $' + medPsf);
    doc.text('Subject is $' + (subPsf - avgPsf) + '/SF ABOVE comparable average');
    doc.moveDown(0.5);
    
    // Comp ranking
    doc.fontSize(10).font('Helvetica-Bold').text('Comp Ranking (by Adjusted Value)');
    doc.moveDown(0.3);
    doc.fontSize(7).font('Helvetica');
    
    const ranked = comps.map((c, i) => ({ ...c, adj: allAdj[i], num: i + 1 }))
        .sort((a, b) => a.adj.adjustedValue - b.adj.adjustedValue);
    
    for (let i = 0; i < ranked.length; i++) {
        const c = ranked[i];
        const psf = c.sqft ? Math.round(c.marketValue / c.sqft) : 0;
        const note = c.selectionNote || buildNote(c, subject);
        doc.text((i+1) + '. [Comp #' + c.num + '] ' + c.address + ' — Adj: ' + fmt(c.adj.adjustedValue) + ' ($' + psf + '/SF) — ' + note, { width: 500 });
    }
    doc.moveDown(0.5);
    
    // Argument
    doc.fontSize(10).font('Helvetica-Bold').text('PROTEST ARGUMENT');
    doc.moveDown(0.3);
    doc.fontSize(8).font('Helvetica');
    
    const avgAdj = Math.round(stats.adjValues.reduce((s,v) => s+v, 0) / stats.adjValues.length);
    const overPct = ((subject.assessedValue - stats.median) / stats.median * 100).toFixed(1);
    
    doc.text('1. OVERVALUATION: The subject is appraised at $' + subject.assessedValue.toLocaleString() + ', which is ' + overPct + '% above the median adjusted value of ' + comps.length + ' comparable properties ($' + stats.median.toLocaleString() + '). Range: $' + stats.min.toLocaleString() + ' – $' + stats.max.toLocaleString() + '.', { width: 500 });
    doc.moveDown(0.2);
    doc.text('2. CONDITION: The subject is an older, dated property in fair/investment-grade condition — not comparable to newer luxury builds in the corridor. Improvement value of $' + (subject.improvementValue || 0).toLocaleString() + ' reflects a structure needing updates.', { width: 500 });
    doc.moveDown(0.2);
    doc.text('3. EXCESS ACREAGE: The subject sits on ' + subject.acres + ' acres. Excess rural acreage does NOT scale linearly with value. Land beyond typical residential use has diminishing returns. Comparable acreage properties are assessed substantially lower.', { width: 500 });
    doc.moveDown(0.2);
    doc.text('4. MARKET MISMATCH: Scenic Loop contains a mix of older modest homes and newer luxury estates ($1M+). This ' + subject.sqft + ' SF property aligns with the former category. The district appraisal reflects the luxury segment, not the subject\'s actual position.', { width: 500 });
    doc.moveDown(0.2);
    doc.text('5. UNEQUAL APPRAISAL (§41.41(a)(2)): After adjusting for size, age, condition, and land, the subject should be valued at approximately $' + stats.median.toLocaleString() + ' — the median of ' + comps.length + ' adjusted comparable properties.', { width: 500 });
    doc.moveDown(0.5);
    
    doc.fontSize(10).font('Helvetica-Bold').text('REQUESTED RELIEF');
    doc.fontSize(8).font('Helvetica');
    doc.text('Reduce appraised value from $' + subject.assessedValue.toLocaleString() + ' to $' + stats.median.toLocaleString() + ', consistent with comparable market evidence.', { width: 500 });
    
    doc.moveDown(1);
    doc.fontSize(7).fillColor('#666');
    doc.text('TaxNet USA Standard | ' + comps.length + ' Comps | Generated: ' + new Date().toISOString().slice(0,10) + ' | OverAssessed, LLC', { align: 'center' });
    doc.fillColor('#000');
}

function buildNote(comp, subject) {
    const parts = [];
    if (comp.sqft) parts.push(comp.sqft + 'SF');
    if (comp.yearBuilt) parts.push('built ' + comp.yearBuilt);
    if (comp.acres) parts.push(comp.acres + 'ac');
    if (comp.acres >= 3) parts.push('acreage match');
    if (Math.abs((comp.sqft||0) - subject.sqft) <= 150) parts.push('close sqft match');
    parts.push('Scenic Loop corridor');
    return parts.join(', ');
}

// ── MAIN GENERATOR ──
async function generateTaxNetPackage(caseData, property, comps) {
    const v = validatePackage(comps, property);
    if (!v.valid) throw new Error('TaxNet BLOCKED: ' + v.errors.join('; '));
    
    const allAdj = comps.map(c => calcAdjustments(c, property));
    
    const caseId = caseData.case_id;
    const filename = caseId + '-Filing-Package.pdf';
    const filePath = path.join(FILING_DIR, filename);
    
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);
        
        renderForm50132(doc, caseData, property);
        const stats = renderEUGrid(doc, property, comps, allAdj);
        renderEvidence(doc, caseData, property, comps, allAdj, stats);
        
        doc.end();
        stream.on('finish', () => resolve({
            filePath, filename, format: 'taxnet_standard',
            compsUsed: comps.length, stats,
            adjustments: allAdj.map((a, i) => ({
                comp: comps[i].address, adjustedValue: a.adjustedValue,
                netPct: a.netPct, grossPct: a.grossPct
            }))
        }));
        stream.on('error', reject);
    });
}

module.exports = { generateTaxNetPackage, validatePackage, calcAdjustments, FILING_DIR };
