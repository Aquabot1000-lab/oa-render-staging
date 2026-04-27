/**
 * OverAssessed Filing Package Generator v3
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
const { generateMapImage, geocode } = require('./map-generator');

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
    doc.text('Texas Comptroller Form 50-132 — Equal & Uniform Protest', 50, 720, { align: 'center', width: 500 });
    doc.fillColor('#000');
}

// ── PAGE(S): E&U Comp Grid — TaxNet USA format exactly ──
// 3 comps per page, portrait, subject column on every page, header repeats
function renderEUGrid(doc, subject, comps, allAdj, finalValue) {
    const COMPS_PER_PAGE = 3;
    const pages = [];
    for (let i = 0; i < comps.length; i += COMPS_PER_PAGE)
        pages.push(comps.slice(i, i + COMPS_PER_PAGE));

    const adjValues = allAdj.map(a => a.adjustedValue);
    adjValues.sort((a, b) => a - b);
    const medianVal = adjValues[Math.floor(adjValues.length / 2)];
    const minVal = adjValues[0];
    const maxVal = adjValues[adjValues.length - 1];

    // Identify median comp index
    const medianIdx = allAdj.findIndex(a => a.adjustedValue === medianVal);

    // Layout constants — portrait LETTER
    const PW = 612, PH = 792;
    const ML = 28, MR = 28, MT = 28;
    const contentW = PW - ML - MR;  // 556
    const LABEL_W = 130;             // row label column
    const COLS = 1 + COMPS_PER_PAGE; // subject + 3 comps = 4 data cols
    const COL_W = Math.floor((contentW - LABEL_W) / COLS); // ~106 each
    const ROW_H = 14;                // tight single-line rows like TaxNet
    const FSZ = 6.5;                 // font size — fits all values in col
    const FSZ_HDR = 7;               // header font
    const HEADER_H = 76;             // total header block height
    const FOOTER_Y = PH - 32;

    function drawPageHeader(pg) {
        // Blue title bar
        doc.rect(ML, MT, contentW, 16).fill('#1a3a5c');
        doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(9)
            .text('Equal & Uniform Analysis', ML, MT + 3, { width: contentW, align: 'center', lineBreak: false });
        doc.fillColor('#000');

        // Subject address + owner line
        doc.font('Helvetica-Bold').fontSize(8)
            .text(subject.address.toUpperCase(), ML, MT + 22, { lineBreak: false });
        doc.font('Helvetica').fontSize(7)
            .text('Tax ID: ' + (subject.accountId || ''), ML, MT + 32, { lineBreak: false })
            .text('Owner: ' + (subject.ownerName || ''), ML + 180, MT + 32, { lineBreak: false });

        // Indicated value summary line — use minimum adjusted comp as recommended value
        const recommendedVal = (finalValue !== undefined) ? finalValue : minVal;
        const noticedVal = subject.assessedValue || 0;
        const noticeToRecDiff = noticedVal - recommendedVal;
        const noticeToRecPct = noticedVal > 0 ? ((noticeToRecDiff / noticedVal) * 100).toFixed(1) : '0.0';
        doc.font('Helvetica-Bold').fontSize(7.5)
            .text('Indicated Value ' + fmt(recommendedVal), ML, MT + 44, { lineBreak: false });
        doc.font('Helvetica').fontSize(6.5)
            .text(
                'Number of Comps: ' + comps.length +
                ' . Appraised Value: ' + fmt(noticedVal) +
                ' → Recommended Value: ' + fmt(recommendedVal) +
                ' (' + noticeToRecPct + '% reduction)',  // Max/Median removed per Tyler directive
                ML, MT + 54, { width: contentW, lineBreak: false });

        // Divider
        doc.moveTo(ML, MT + 64).lineTo(ML + contentW, MT + 64).lineWidth(0.5).stroke('#aaa');
    }

    function drawColHeaders(y, pageComps, pgOffset) {
        doc.rect(ML, y, contentW, ROW_H).fill('#2c3e50');
        doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(FSZ_HDR);
        const o = { lineBreak: false, ellipsis: true };
        doc.text('(CAD 2026)', ML + 2, y + 3, { ...o, width: LABEL_W - 4 });
        doc.text('SUBJECT', ML + LABEL_W, y + 3, { ...o, width: COL_W - 2 });
        for (let c = 0; c < pageComps.length; c++) {
            const num = pgOffset + c + 1;
            const label = 'COMP ' + num;  // No MEDIAN label per Tyler directive
            doc.text(label, ML + LABEL_W + COL_W * (c + 1), y + 3, { ...o, width: COL_W - 2 });
        }
        doc.fillColor('#000');
    }

    function cell(text, x, y, bold, highlight) {
        const font = bold ? 'Helvetica-Bold' : 'Helvetica';
        const color = highlight ? '#1a3a5c' : '#000';
        doc.font(font).fontSize(FSZ).fillColor(color)
            .text(String(text || ''), x + 2, y + 3, { width: COL_W - 4, lineBreak: false, ellipsis: true });
        doc.fillColor('#000');
    }

    function labelCell(text, x, y) {
        doc.font('Helvetica-Bold').fontSize(FSZ).fillColor('#000')
            .text(String(text || ''), x + 2, y + 3, { width: LABEL_W - 4, lineBreak: false, ellipsis: true });
    }

    function rowBg(y, r, highlight, shade) {
        if (highlight) {
            doc.rect(ML, y, contentW, ROW_H).fill('#d4efdf');
        } else if (r % 2 === 0) {
            doc.rect(ML, y, contentW, ROW_H).fill('#f4f6f7');
        }
        // vertical dividers
        doc.save().strokeColor('#ccc').lineWidth(0.3);
        for (let i = 0; i <= COMPS_PER_PAGE; i++) {
            const lx = ML + LABEL_W + COL_W * i;
            doc.moveTo(lx, y).lineTo(lx, y + ROW_H).stroke();
        }
        doc.restore();
    }

    for (let pg = 0; pg < pages.length; pg++) {
        doc.addPage({ size: 'LETTER', margin: 0 });
        const pageComps = pages[pg];
        const pgOffset = pg * COMPS_PER_PAGE;
        const pageAdjs = pageComps.map((_, k) => allAdj[pgOffset + k]);

        drawPageHeader(pg);

        // Footer
        doc.font('Helvetica').fontSize(6).fillColor('#888')
            .text(
                cap(subject.county || '') + ' County   ' +
                new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
                '   Page ' + (pg + 1) + ' of ' + pages.length +
                '   Confidential © 2026 OverAssessed, LLC',
                ML, FOOTER_Y, { width: contentW, align: 'center', lineBreak: false });
        doc.fillColor('#000');

        // Column headers
        let y = MT + HEADER_H;
        drawColHeaders(y, pageComps, pgOffset);
        y += ROW_H;

        // Row data
        const subPsf = subject.sqft ? Math.round(subject.assessedValue / subject.sqft) : 0;

        const rows = [
            {
                label: 'Tax ID',
                sub: subject.accountId || '',
                vals: pageComps.map(c => c.propId || c.parcelId || '')
            },
            {
                label: 'Address',
                sub: (subject.address || '').substring(0, 28),
                vals: pageComps.map(c => (c.address || '').substring(0, 28))
            },
            {
                label: 'Market Value',
                sub: fmt(subject.assessedValue),
                vals: pageComps.map(c => fmt(c.marketValue))
            },
            {
                label: 'Distance (Miles)',
                sub: '-',
                vals: pageComps.map(c => c.distance != null ? c.distance.toFixed(2) : '-')
            },
            {
                label: 'Property Class',
                sub: subject.propClass || 'A1',
                vals: pageComps.map(c => c.propClass || 'A1')
            },
            {
                label: 'Condition',
                sub: subject.conditionLabel || 'Average',
                vals: pageComps.map(c => c.conditionLabel || 'Average')
            },
            {
                label: 'Year Built (Effective)',
                sub: (subject.yearBuilt||'') + (subject.effectiveYear ? ' (' + subject.effectiveYear + ')' : ''),
                vals: pageComps.map(c => (c.yearBuilt||'') + (c.effectiveYear ? ' (' + c.effectiveYear + ')' : ''))
            },
            {
                label: 'Main SQFT (PSF)',
                sub: (subject.sqft||0).toLocaleString() + ' ($' + subPsf + ')',
                vals: pageComps.map(c => {
                    const psf = c.sqft ? Math.round((c.marketValue||0) / c.sqft) : 0;
                    return (c.sqft||0).toLocaleString() + ' ($' + psf + ')';
                })
            },
            {
                label: 'Improvement Value',
                sub: fmt(subject.improvementValue || (subject.assessedValue - (subject.landValue||0))),
                vals: pageComps.map(c => fmt(c.improvValue || Math.max(0, (c.marketValue||0) - (c.landValue||0))))
            },
            {
                label: 'Feature Value',
                sub: fmt(subject.featureValue || 0),
                vals: pageComps.map(c => fmt(c.featureValue || 0))
            },
            {
                label: 'Pool Value',
                sub: fmt(subject.poolValue || 0),
                vals: pageComps.map(c => fmt(c.poolValue || 0))
            },
            {
                label: 'Land Value',
                sub: fmt(subject.landValue || 0),
                vals: pageComps.map(c => fmt(c.landValue || 0))
            },
            { label: '', sub: '', vals: pageComps.map(() => ''), spacer: true },
            {
                label: 'Age Adjustment',
                sub: '-',
                vals: pageAdjs.map(a => fmtAdj(a.ageAdj, a.agePct)),
                adj: true
            },
            {
                label: 'Size Adjustment',
                sub: '-',
                vals: pageAdjs.map(a => fmtAdj(a.sizeAdj, a.sizePct)),
                adj: true
            },
            {
                label: 'Land Adjustment',
                sub: '-',
                vals: pageAdjs.map(a => fmtAdj(a.landAdj, a.landPct)),
                adj: true
            },
            {
                label: 'Feature Adjustment',
                sub: '-',
                vals: pageAdjs.map(a => fmtAdj(a.featureAdj || 0, a.featurePct || 0)),
                adj: true
            },
            {
                label: 'Pool Adjustment',
                sub: '-',
                vals: pageAdjs.map(a => fmtAdj(a.poolAdj || 0, a.poolPct || 0)),
                adj: true
            },
            {
                label: 'Net Adjustment',
                sub: '-',
                vals: pageAdjs.map(a => fmtAdj(a.netAdj, a.netPct)),
                bold: true, adj: true
            },
            {
                label: 'Total Adjusted Value',
                sub: '-',
                vals: pageAdjs.map(a => fmt(a.adjustedValue)),
                bold: true, highlight: true
            },
        ];

        for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            if (row.spacer) { y += 4; continue; }
            rowBg(y, r, row.highlight, row.adj);
            labelCell(row.label, ML, y);
            cell(row.sub, ML + LABEL_W, y, row.bold, row.highlight);
            for (let c = 0; c < pageComps.length; c++) {
                cell(row.vals[c], ML + LABEL_W + COL_W * (c + 1), y, row.bold, row.highlight);
            }
            y += ROW_H;
        }

        // Bottom border
        doc.moveTo(ML, y).lineTo(ML + contentW, y).lineWidth(0.5).stroke('#aaa');
    }

    return { median: medianVal, min: minVal, max: maxVal, adjValues };
}

// ── PAGE: Evidence Summary ──
function renderEvidence(doc, caseData, subject, comps, allAdj, stats, finalValue) {
    doc.addPage({ size: 'LETTER', margin: 50 });
    
    doc.fontSize(12).font('Helvetica-Bold').text('Evidence Summary & Protest Argument', { align: 'center' });
    doc.fontSize(8).font('Helvetica').text('Equal & Uniform Analysis — Supporting Documentation', { align: 'center' });
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
    doc.text('Comp $/SF Range: $' + Math.min(...compPsfs).toLocaleString() + ' – $' + Math.max(...compPsfs).toLocaleString() + '  (Subject: $' + subPsf + '/SF)');  // No Avg/Median per Tyler directive
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
    const recVal = (finalValue !== undefined) ? finalValue : stats.min;
    const noticedVal2 = subject.assessedValue || 0;
    const overPct = noticedVal2 > 0 ? ((noticedVal2 - recVal) / noticedVal2 * 100).toFixed(1) : '0.0';
    
    doc.text('1. OVERVALUATION: The district appraised value of $' + noticedVal2.toLocaleString() + ' exceeds our recommended value of $' + recVal.toLocaleString() + ' by ' + overPct + '% — a difference of $' + (noticedVal2 - recVal).toLocaleString() + '. Comparable evidence supports a reduction. Comp range: $' + stats.min.toLocaleString() + ' – $' + stats.max.toLocaleString() + ' (' + comps.length + ' properties).', { width: 500 });
    doc.moveDown(0.2);
    // Dynamic condition language based on property characteristics
    const builtYear = subject.yearBuilt || subject.effectiveYear || 0;
    const isNewConstruction = builtYear >= 2020;
    const isRuralAcreage = (subject.acres && subject.acres >= 1.0) || (subject.landValue && subject.improvementValue && subject.landValue > subject.improvementValue);
    const isOlderProperty = builtYear > 0 && builtYear < 2000;

    let conditionText;
    if (isNewConstruction) {
        conditionText = '2. PROPERTY CHARACTERISTICS: The subject is a production home consistent with similar builder-grade properties in the subdivision. Improvement value of $' + (subject.improvementValue || 0).toLocaleString() + ' should be evaluated relative to comparable builder-grade homes, not premium custom builds.';
    } else if (isRuralAcreage) {
        conditionText = '2. PROPERTY CHARACTERISTICS: The subject includes significant land value ($' + (subject.landValue || 0).toLocaleString() + ') and requires adjusted comparison for acreage and rural characteristics. Excess rural acreage does not scale linearly with value — land beyond typical residential use has diminishing marginal returns.';
    } else if (isOlderProperty) {
        conditionText = '2. CONDITION: The subject is an older, dated property — not comparable to newer construction in the area. Improvement value of $' + (subject.improvementValue || 0).toLocaleString() + ' reflects a structure with deferred maintenance and functional obsolescence relative to newer builds.';
    } else {
        conditionText = '2. PROPERTY CHARACTERISTICS: The subject improvement value of $' + (subject.improvementValue || 0).toLocaleString() + ' should be evaluated in context of comparable properties of similar age, size, and condition in the immediate market area.';
    }
    doc.text(conditionText, { width: 500 });
    doc.moveDown(0.2);

    // Acreage argument — only if applicable
    if (isRuralAcreage && subject.acres >= 1.0) {
        doc.text('3. EXCESS ACREAGE: The subject sits on ' + subject.acres + ' acres. Excess rural acreage does NOT scale linearly with value. Land beyond typical residential use has diminishing returns. Comparable acreage properties are assessed substantially lower.', { width: 500 });
    } else {
        doc.text('3. MARKET POSITION: The subject\'s size (' + (subject.sqft || 0).toLocaleString() + ' SF), age (' + (builtYear || 'N/A') + '), and improvement value align with the comparable properties selected. The district appraisal is inconsistent with the market evidence presented.', { width: 500 });
    }
    doc.moveDown(0.2);
    doc.text('4. COMPARABLE EVIDENCE: The ' + comps.length + ' comparable properties selected reflect similar size, age, condition, and location characteristics. After adjustments, the indicated value range is $' + stats.min.toLocaleString() + ' – $' + stats.max.toLocaleString() + '.', { width: 500 });  // No median per Tyler directive
    doc.moveDown(0.2);
    doc.text('5. UNEQUAL APPRAISAL (§41.41(a)(2)): After adjusting for size, age, condition, and land, the subject should be valued at approximately $' + recVal.toLocaleString() + ' — our recommended value, supported by ' + comps.length + ' adjusted comparable properties.', { width: 500 });  // No median per Tyler directive
    doc.moveDown(0.5);

    // ── County-specific narrative blocks (Bexar acreage only) ──
    const countyKey = (caseData.county || subject.county || '').toLowerCase();
    if (countyKey.includes('bexar') && isRuralAcreage) {
        doc.fontSize(10).font('Helvetica-Bold').text('BEXAR COUNTY — ACREAGE ANALYSIS');
        doc.moveDown(0.3);
        doc.fontSize(8).font('Helvetica');
        const landPct = subject.landValue && subject.assessedValue ? ((subject.landValue / subject.assessedValue) * 100).toFixed(1) : 'N/A';
        doc.text('ACREAGE ADJUSTMENT: The subject sits on ' + subject.acres + ' acres. Rural acreage carries diminishing marginal value — land beyond standard residential use does not scale dollar-for-dollar. The ' + subject.acres + '-acre parcel includes excess rural land that appraisal districts routinely over-equalize versus smaller suburban lots.', { width: 500 });
        doc.moveDown(0.2);
        doc.text('MARKET MISMATCH: The Scenic Loop corridor contains a wide spectrum from modest rural homesteads ($450K–$650K) to luxury estates ($1M+). This ' + subject.sqft + ' SF, ' + subject.acres + '-acre property aligns with the rural homestead tier, not the luxury custom-build segment. Comps were selected exclusively from the non-luxury tier to ensure an apples-to-apples comparison.', { width: 500 });
        doc.moveDown(0.2);
        doc.text('LAND VALUE BREAKDOWN: District land value of $' + (subject.landValue || 0).toLocaleString() + ' represents ' + landPct + '% of total assessed value ($' + (subject.assessedValue || 0).toLocaleString() + '). Improvement value of $' + (subject.improvementValue || 0).toLocaleString() + ' accounts for the ' + subject.sqft + ' SF structure built in ' + (subject.yearBuilt || 'N/A') + '. Comparable land values in the corridor range from $200K–$380K for similar acreage parcels.', { width: 500 });
        doc.moveDown(0.5);
    }

    // ── County standards footer ──
    const maxDist = Math.max(...comps.map(c => c.distance || 0));
    let countyStandardNote = '';
    if (countyKey.includes('collin')) {
        countyStandardNote = 'Collin County standards applied: same-subdivision comps only, ±10% sqft, ±1 yr built, min 6–8 comps, no out-of-area comps.';
    } else if (countyKey.includes('fort bend') || countyKey.includes('fortbend')) {
        countyStandardNote = 'Fort Bend County standards applied: same-subdivision preferred, 10–15 comps, clean adjustment grid.';
    } else if (countyKey.includes('bexar')) {
        countyStandardNote = 'Bexar County standards applied: Scenic Loop / Helotes Creek corridor, acreage match, no luxury mixing, max 5-mile radius.';
    }
    
    doc.fontSize(10).font('Helvetica-Bold').text('REQUESTED RELIEF');
    doc.fontSize(8).font('Helvetica');
    doc.text('Reduce appraised value from $' + noticedVal2.toLocaleString() + ' to our recommended value of $' + recVal.toLocaleString() + ' — a reduction of $' + (noticedVal2 - recVal).toLocaleString() + ' (' + overPct + '%), consistent with comparable market evidence.', { width: 500 });
    
    doc.moveDown(1);
    doc.fontSize(7).fillColor('#666');
    if (countyStandardNote) {
        doc.text(countyStandardNote + '  |  Max comp distance: ' + maxDist.toFixed(1) + ' mi  |  Comp count: ' + comps.length, { align: 'center', width: 500 });
        doc.moveDown(0.3);
    }
    doc.text(comps.length + ' Comps | Generated: ' + new Date().toISOString().slice(0,10) + ' | OverAssessed, LLC', { align: 'center' });
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
// ── PAGE: Subject Map ──
async function renderSubjectMap(doc, caseData, property) {
    doc.addPage({ size: 'LETTER', margin: 30 });
    const PW = 612, PH = 792;
    const ML = 30, contentW = PW - 60;

    // Header
    doc.rect(ML, 28, contentW, 16).fill('#1a3a5c');
    doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(9)
        .text('Subject Property Location', ML, 31, { width: contentW, align: 'center', lineBreak: false });
    doc.fillColor('#000');

    doc.font('Helvetica-Bold').fontSize(8).text(property.address.toUpperCase(), ML, 52, { lineBreak: false });
    doc.font('Helvetica').fontSize(7)
        .text(cap(property.county || '') + ' County  |  Tax ID: ' + (property.accountId || 'N/A') + '  |  Assessed: $' + (property.assessedValue || 0).toLocaleString(), ML, 63, { lineBreak: false });

    let mapBuf = null;
    try {
        const geo = await geocode(property.address);
        if (geo) {
            mapBuf = await generateMapImage(geo.lat, geo.lon, 15, 3, 3, [
                { lat: geo.lat, lon: geo.lon, color: [220, 30, 30] }
            ]);
        }
    } catch (e) {
        console.log('[MapGen] Subject map failed:', e.message);
    }

    if (mapBuf) {
        doc.image(mapBuf, ML, 76, { width: contentW, height: 580, fit: [contentW, 580] });
    } else {
        doc.rect(ML, 76, contentW, 580).fill('#f0f0f0');
        doc.fillColor('#888').font('Helvetica').fontSize(10)
            .text('Map unavailable — ' + property.address, ML, 340, { width: contentW, align: 'center' });
    }

    doc.fillColor('#888').font('Helvetica').fontSize(6)
        .text('Map data © OpenStreetMap contributors', ML, 665, { width: contentW, align: 'right', lineBreak: false });
    doc.fillColor('#000');
}

// ── PAGE: Comparables Map ──
async function renderCompsMap(doc, caseData, property, comps) {
    doc.addPage({ size: 'LETTER', margin: 30 });
    const PW = 612, PH = 792;
    const ML = 30, contentW = PW - 60;

    // Header
    doc.rect(ML, 28, contentW, 16).fill('#1a3a5c');
    doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(9)
        .text('Subject & Comparable Properties Map', ML, 31, { width: contentW, align: 'center', lineBreak: false });
    doc.fillColor('#000');

    doc.font('Helvetica-Bold').fontSize(8).text(property.address.toUpperCase(), ML, 52, { lineBreak: false });
    doc.font('Helvetica').fontSize(7)
        .text(comps.length + ' comparable properties shown  |  ' + cap(property.county || '') + ' County', ML, 63, { lineBreak: false });

    // Geocode subject + all comps
    let mapBuf = null;
    try {
        const subGeo = await geocode(property.address);
        if (subGeo) {
            const markers = [{ lat: subGeo.lat, lon: subGeo.lon, color: [220, 30, 30], label: 'S' }]; // red = subject

            // Geocode comps (limit to 10, with delay to respect Nominatim rate limit)
            // Comps may include pre-geocoded coordinates (lat/lon fields) to bypass geocoder for rural addresses
            const compGeos = [];
            for (let i = 0; i < Math.min(comps.length, 10); i++) {
                const comp = comps[i];
                // Use pre-geocoded coords if provided
                if (comp.lat && comp.lon) {
                    compGeos.push({ lat: comp.lat, lon: comp.lon, idx: i });
                    continue;
                }
                try {
                    await new Promise(r => setTimeout(r, 350)); // Nominatim rate limit: 1 req/sec
                    const g = await geocode(comp.address);
                    if (g) compGeos.push({ ...g, idx: i });
                } catch (e) {}
            }

            for (const g of compGeos) {
                markers.push({ lat: g.lat, lon: g.lon, color: [30, 80, 180], label: g.idx + 1 }); // blue = comps, numbered
            }

            // Auto-zoom: fit all markers
            const lats = markers.map(m => m.lat);
            const lons = markers.map(m => m.lon);
            const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
            const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
            const spanLat = Math.max(...lats) - Math.min(...lats);
            const spanLon = Math.max(...lons) - Math.min(...lons);
            const span = Math.max(spanLat, spanLon);
            const zoom = span < 0.01 ? 15 : span < 0.05 ? 13 : span < 0.15 ? 12 : span < 0.5 ? 11 : 10;

            mapBuf = await generateMapImage(centerLat, centerLon, zoom, 4, 4, markers);
        }
    } catch (e) {
        console.log('[MapGen] Comps map failed:', e.message);
    }

    if (mapBuf) {
        doc.image(mapBuf, ML, 76, { width: contentW, height: 530, fit: [contentW, 530] });
    } else {
        doc.rect(ML, 76, contentW, 530).fill('#f0f0f0');
        doc.fillColor('#888').font('Helvetica').fontSize(10)
            .text('Map unavailable', ML, 330, { width: contentW, align: 'center' });
    }

    // Legend
    let ly = 616;
    doc.rect(ML, ly, contentW, 50).fill('#f8f9fa');
    doc.rect(ML + 10, ly + 10, 12, 12).fill('#DC1E1E');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(7)
        .text('SUBJECT: ' + property.address, ML + 26, ly + 12, { lineBreak: false });
    doc.rect(ML + 10, ly + 28, 12, 12).fill('#1E50B4');
    doc.font('Helvetica').fontSize(7)
        .text(comps.length + ' Comparable Properties — adjusted values range $' +
            Math.min(...comps.map(c => c.marketValue || 0)).toLocaleString() + ' – $' +
            Math.max(...comps.map(c => c.marketValue || 0)).toLocaleString(),
            ML + 26, ly + 30, { lineBreak: false });

    doc.fillColor('#888').fontSize(6)
        .text('Map data © OpenStreetMap contributors', ML, ly + 44, { width: contentW, align: 'right', lineBreak: false });
    doc.fillColor('#000');
}

async function generateTaxNetPackage(caseData, property, comps) {
    const v = validatePackage(comps, property);
    if (!v.valid) throw new Error('TaxNet BLOCKED: ' + v.errors.join('; '));

    // ── SINGLE SOURCE OF TRUTH ──────────────────────────────────────────────
    // Step 1: Compute adjusted comps FIRST
    const allAdj = comps.map(c => calcAdjustments(c, property));
    const adjValuesSorted = allAdj.map(a => a.adjustedValue).sort((a, b) => a - b);
    const minAdjustedValue  = adjValuesSorted[0];
    const medianAdjustedValue = adjValuesSorted[Math.floor(adjValuesSorted.length / 2)];

    // Step 2: County-specific final value rule
    // Collin   → MEDIAN  |  Fort Bend → MEDIAN  |  Bexar → MIN  |  default → MIN
    const countyRaw = (caseData.county || property.county || '').toLowerCase().trim();
    let finalValue;
    if (countyRaw.includes('collin') || countyRaw.includes('fort bend') || countyRaw.includes('fortbend')) {
        finalValue = medianAdjustedValue;
    } else {
        finalValue = minAdjustedValue; // Bexar and all others
    }

    // Step 3: Strip any externally-passed opinionOfValue — generator owns this value
    property = { ...property, opinionOfValue: finalValue };
    // ────────────────────────────────────────────────────────────────────────

    const caseId = caseData.case_id;
    const filename = caseId + '-Filing-Package.pdf';
    const filePath = path.join(FILING_DIR, filename);

    // Generate map images before opening PDF stream
    console.log('[TaxNet] Geocoding subject + comps for maps...');
    let subjectMapBuf = null, compsMapBuf = null;
    try {
        const subGeo = await geocode(property.address);
        if (subGeo) {
            subjectMapBuf = await generateMapImage(subGeo.lat, subGeo.lon, 15, 3, 3, [
                { lat: subGeo.lat, lon: subGeo.lon, color: [220, 30, 30], label: 'S' }
            ]);

            const markers = [{ lat: subGeo.lat, lon: subGeo.lon, color: [220, 30, 30], label: 'S' }];
            for (let i = 0; i < Math.min(comps.length, 10); i++) {
                const comp = comps[i];
                // Use pre-geocoded lat/lon if provided (for rural addresses not in geocoder DBs)
                if (comp.lat && comp.lon) {
                    markers.push({ lat: comp.lat, lon: comp.lon, color: [30, 80, 180], label: String(i + 1) });
                    continue;
                }
                await new Promise(r => setTimeout(r, 350));
                const g = await geocode(comp.address);
                if (g) markers.push({ lat: g.lat, lon: g.lon, color: [30, 80, 180], label: String(i + 1) });
            }
            const lats = markers.map(m => m.lat);
            const lons = markers.map(m => m.lon);
            const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
            const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
            const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lons) - Math.min(...lons));
            const zoom = span < 0.01 ? 15 : span < 0.05 ? 13 : span < 0.15 ? 12 : span < 0.5 ? 11 : 10;
            compsMapBuf = await generateMapImage(centerLat, centerLon, zoom, 4, 4, markers);
            console.log('[TaxNet] Maps generated. Subject + ' + (markers.length - 1) + ' comps.');
        }
    } catch (e) {
        console.log('[TaxNet] Map generation failed (non-fatal):', e.message);
    }

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        const PW = 612, PH = 792, ML = 30;
        const contentW = PW - 60;

        renderForm50132(doc, caseData, property);
        const stats = renderEUGrid(doc, property, comps, allAdj, finalValue);
        renderEvidence(doc, caseData, property, comps, allAdj, stats, finalValue);

        // Subject Map page
        doc.addPage({ size: 'LETTER', margin: 0 });
        doc.rect(ML, 28, contentW, 16).fill('#1a3a5c');
        doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(9)
            .text('Subject Property Location', ML, 31, { width: contentW, align: 'center', lineBreak: false });
        doc.fillColor('#000');
        doc.font('Helvetica-Bold').fontSize(8).text(property.address.toUpperCase(), ML, 52, { lineBreak: false });
        doc.font('Helvetica').fontSize(7)
            .text(cap(property.county || '') + ' County  |  Tax ID: ' + (property.accountId || 'N/A') + '  |  Assessed: $' + (property.assessedValue || 0).toLocaleString(), ML, 63, { lineBreak: false });
        if (subjectMapBuf) {
            doc.image(subjectMapBuf, ML, 76, { width: contentW, height: 580, fit: [contentW, 580] });
        } else {
            doc.rect(ML, 76, contentW, 580).fill('#f0f0f0');
            doc.fillColor('#999').fontSize(10).text('Map unavailable', ML, 350, { width: contentW, align: 'center' });
        }
        doc.fillColor('#888').font('Helvetica').fontSize(6)
            .text('Map data © OpenStreetMap contributors', ML, 665, { width: contentW, align: 'right', lineBreak: false });
        doc.fillColor('#000');

        // Comparables Map page
        doc.addPage({ size: 'LETTER', margin: 0 });
        doc.rect(ML, 28, contentW, 16).fill('#1a3a5c');
        doc.fillColor('#FFF').font('Helvetica-Bold').fontSize(9)
            .text('Subject & Comparable Properties Map', ML, 31, { width: contentW, align: 'center', lineBreak: false });
        doc.fillColor('#000');
        doc.font('Helvetica-Bold').fontSize(8).text(property.address.toUpperCase(), ML, 52, { lineBreak: false });
        doc.font('Helvetica').fontSize(7)
            .text(comps.length + ' comparable properties shown  |  ' + cap(property.county || '') + ' County', ML, 63, { lineBreak: false });
        if (compsMapBuf) {
            doc.image(compsMapBuf, ML, 76, { width: contentW, height: 530, fit: [contentW, 530] });
        } else {
            doc.rect(ML, 76, contentW, 530).fill('#f0f0f0');
            doc.fillColor('#999').fontSize(10).text('Map unavailable', ML, 330, { width: contentW, align: 'center' });
        }
        // Legend
        const ly = 616;
        doc.rect(ML, ly, contentW, 50).fill('#f8f9fa');
        doc.rect(ML + 10, ly + 10, 12, 12).fill('#DC1E1E');
        doc.fillColor('#000').font('Helvetica-Bold').fontSize(7)
            .text('SUBJECT: ' + property.address, ML + 26, ly + 12, { lineBreak: false });
        doc.rect(ML + 10, ly + 28, 12, 12).fill('#1E50B4');
        doc.font('Helvetica').fontSize(7)
            .text(comps.length + ' Comparable Properties', ML + 26, ly + 30, { lineBreak: false });
        doc.fillColor('#888').fontSize(6)
            .text('Map data © OpenStreetMap contributors', ML, ly + 44, { width: contentW, align: 'right', lineBreak: false });
        doc.fillColor('#000');

        doc.end();
        stream.on('finish', () => {
            // ── HARD VALIDATION: all value references must equal finalValue ──
            const mismatches = [];
            if (property.opinionOfValue !== finalValue)
                mismatches.push(`opinionOfValue (${property.opinionOfValue}) ≠ finalValue (${finalValue})`);
            if (mismatches.length > 0) {
                // Delete the bad PDF so it cannot be used
                try { require('fs').unlinkSync(filePath); } catch(e) {}
                reject(new Error('PACKAGE VALIDATION FAILED — value mismatch: ' + mismatches.join('; ')));
                return;
            }
            // ────────────────────────────────────────────────────────────────────────
            resolve({
                filePath, filename, format: 'taxnet_standard',
                compsUsed: comps.length, stats,
                recommendedValue: finalValue,
                countyRule: (countyRaw.includes('collin') || countyRaw.includes('fort bend') || countyRaw.includes('fortbend')) ? 'median' : 'min',
                validationPassed: true,
                adjustments: allAdj.map((a, i) => ({
                    comp: comps[i].address, adjustedValue: a.adjustedValue,
                    netPct: a.netPct, grossPct: a.grossPct
                }))
            });
        });
        stream.on('error', reject);
    });
}

module.exports = { generateTaxNetPackage, validatePackage, calcAdjustments, FILING_DIR };
