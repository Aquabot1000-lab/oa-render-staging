/**
 * TaxNet USA Standard Filing Package Generator
 * Form 50-132 (Notice of Protest) + Comparable Analysis + Evidence
 * 
 * GLOBAL STANDARD per Tyler directive 2026-04-15:
 * - Official Texas Form 50-132 ONLY
 * - 8-12 comps, ±20% sqft, ±15 yrs built, lower-valued prioritized
 * - Combined PDF: Form → Comps → Evidence → Notice
 * - Tag: filing_format = taxnet_standard
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

/**
 * Validate comps meet TaxNet standard before generating
 */
function validateComps(comps, subject) {
    const valid = comps.filter(c => {
        const sqftDiff = Math.abs(c.sqft - subject.sqft) / subject.sqft;
        const yrDiff = (c.yearBuilt && subject.yearBuilt) ? Math.abs(c.yearBuilt - subject.yearBuilt) : 0;
        return sqftDiff <= 0.20 && yrDiff <= 15;
    });
    return {
        valid: valid.length >= 8,
        count: valid.length,
        comps: valid,
        reason: valid.length < 8 ? `Only ${valid.length} comps meet criteria (need 8+)` : null
    };
}

/**
 * Generate Section 1: Form 50-132 (Notice of Protest)
 */
function renderForm50132(doc, caseData, property) {
    // Header
    doc.fontSize(9).font('Helvetica').text('Form 50-132', 450, 50, { align: 'right' });
    doc.fontSize(8).text('(Rev. 04-23/7)', 450, 62, { align: 'right' });
    
    doc.fontSize(14).font('Helvetica-Bold').text('Notice of Protest', 50, 50, { align: 'left', width: 400 });
    doc.fontSize(10).font('Helvetica').text('Before the Appraisal Review Board', 50, 68);
    doc.fontSize(9).text('Tax Code Sections 41.41, 41.44, 41.45', 50, 82);
    
    doc.moveDown(1);
    const startY = 100;
    
    // Appraisal District Info
    doc.fontSize(9).font('Helvetica-Bold').text('STEP 1: Appraisal District Information', 50, startY);
    doc.font('Helvetica').fontSize(9);
    drawLabelValue(doc, 'Appraisal District Name:', `${capitalize(caseData.county)} County Appraisal District`, 50, startY + 18);
    drawLabelValue(doc, 'Tax Year:', '2026', 400, startY + 18);
    
    // Property Owner Info
    const s2y = startY + 50;
    doc.font('Helvetica-Bold').text('STEP 2: Property Owner / Agent Information', 50, s2y);
    doc.font('Helvetica');
    drawLabelValue(doc, 'Property Owner Name:', caseData.owner_name || '', 50, s2y + 18);
    drawLabelValue(doc, 'Address:', caseData.property_address || '', 50, s2y + 34);
    drawLabelValue(doc, 'Phone:', caseData.phone || '', 50, s2y + 50);
    drawLabelValue(doc, 'Email:', caseData.email || '', 250, s2y + 50);
    
    // Agent info
    drawLabelValue(doc, 'Agent Name:', AGENT_INFO.name, 50, s2y + 70);
    drawLabelValue(doc, 'Agent Address:', AGENT_INFO.address, 50, s2y + 86);
    drawLabelValue(doc, 'Agent Phone:', AGENT_INFO.phone, 50, s2y + 102);
    drawLabelValue(doc, 'Agent Email:', AGENT_INFO.email, 250, s2y + 102);
    
    // Property Description
    const s3y = s2y + 130;
    doc.font('Helvetica-Bold').text('STEP 3: Property Description', 50, s3y);
    doc.font('Helvetica');
    drawLabelValue(doc, 'Property ID / Account Number:', property.accountId || '', 50, s3y + 18);
    drawLabelValue(doc, 'Geographic ID:', property.geoId || '', 350, s3y + 18);
    drawLabelValue(doc, 'Property Address:', caseData.property_address || '', 50, s3y + 34);
    drawLabelValue(doc, 'Legal Description:', (property.legalDescription || '').substring(0, 80), 50, s3y + 50);
    
    // Protest Grounds
    const s4y = s3y + 80;
    doc.font('Helvetica-Bold').text('STEP 4: Reason(s) for Protest (check all that apply)', 50, s4y);
    doc.font('Helvetica').fontSize(9);
    
    const grounds = [
        { checked: true, text: 'Value is over market value (Tax Code Section 41.41(a)(1))' },
        { checked: true, text: 'Value is unequal compared with other properties (Tax Code Section 41.41(a)(2))' },
        { checked: false, text: 'Failure to send required notice (Tax Code Section 41.41(a)(5))' },
        { checked: false, text: 'Property should not be taxed in this district (Tax Code Section 41.41(a)(3))' },
        { checked: false, text: 'Other: ___________________________' }
    ];
    
    let gy = s4y + 18;
    for (const g of grounds) {
        doc.text(`${g.checked ? '☑' : '☐'}  ${g.text}`, 60, gy);
        gy += 16;
    }
    
    // Property Values
    const s5y = gy + 10;
    doc.font('Helvetica-Bold').text('STEP 5: Property Value Information', 50, s5y);
    doc.font('Helvetica');
    
    const assessed = property.assessedValue || caseData.assessed_value || 0;
    const opinion = property.opinionOfValue || Math.round(assessed * 0.75);
    
    drawLabelValue(doc, 'Appraised / Market Value (per district):', '$' + assessed.toLocaleString(), 50, s5y + 18);
    drawLabelValue(doc, 'Property Owner\'s Opinion of Value:', '$' + opinion.toLocaleString(), 50, s5y + 34);
    
    // Description of protest
    const s6y = s5y + 60;
    doc.font('Helvetica-Bold').text('STEP 6: Description of Protest', 50, s6y);
    doc.font('Helvetica').fontSize(8);
    
    const protestText = property.protestDescription || 
        `The appraised value of $${assessed.toLocaleString()} significantly exceeds the market value supported by comparable properties in the area. ` +
        `The attached comparable analysis demonstrates that similar properties (${property.sqft || 'N/A'} sq ft, built ${property.yearBuilt || 'similar era'}) ` +
        `in the ${capitalize(caseData.county)} County area are assessed at substantially lower values. ` +
        `We request the appraisal review board reduce the appraised value to $${opinion.toLocaleString()} based on the evidence presented.`;
    
    doc.text(protestText, 50, s6y + 18, { width: 500 });
    
    // Signature block
    const sigY = doc.y + 30;
    doc.fontSize(9).font('Helvetica-Bold').text('STEP 7: Signature', 50, sigY);
    doc.font('Helvetica');
    doc.text('Property Owner / Agent Signature: ___________________________', 50, sigY + 20);
    doc.text('Date: _______________', 400, sigY + 20);
    doc.text(`Print Name: ${caseData.owner_name || ''}`, 50, sigY + 40);
    
    // Footer
    doc.fontSize(7).fillColor('#666');
    doc.text('Texas Comptroller Form 50-132 — Notice of Protest Before the Appraisal Review Board', 50, 720, { align: 'center', width: 500 });
    doc.text('Generated by OverAssessed, LLC — TaxNet USA Standard Format', 50, 732, { align: 'center', width: 500 });
    doc.fillColor('#000');
}

/**
 * Generate Section 2: Comparable Sales Analysis
 */
function renderCompAnalysis(doc, subject, comps) {
    doc.addPage();
    
    // Header
    doc.fontSize(14).font('Helvetica-Bold').text('Comparable Property Analysis', { align: 'center' });
    doc.fontSize(10).font('Helvetica').text('Supporting Evidence for Notice of Protest', { align: 'center' });
    doc.moveDown(0.5);
    
    // Subject property box
    doc.fontSize(10).font('Helvetica-Bold').text('SUBJECT PROPERTY');
    doc.fontSize(9).font('Helvetica');
    doc.text(`Address: ${subject.address}`);
    doc.text(`Account #: ${subject.accountId || 'N/A'}  |  Geo ID: ${subject.geoId || 'N/A'}`);
    doc.text(`Appraised Value: $${(subject.assessedValue || 0).toLocaleString()}  |  Sq Ft: ${subject.sqft || 'N/A'}  |  Year Built: ${subject.yearBuilt || 'N/A'}  |  Acres: ${subject.acres || 'N/A'}`);
    doc.moveDown(0.5);
    
    // Comp table header
    doc.font('Helvetica-Bold').fontSize(8);
    const tableTop = doc.y;
    const cols = [
        { label: '#', x: 50, w: 20 },
        { label: 'Address', x: 70, w: 160 },
        { label: 'Market Value', x: 230, w: 75 },
        { label: 'Impr Value', x: 305, w: 65 },
        { label: 'Sq Ft', x: 370, w: 40 },
        { label: 'Yr Built', x: 410, w: 40 },
        { label: 'Acres', x: 450, w: 40 },
        { label: 'Nbhd', x: 490, w: 40 }
    ];
    
    // Header row
    doc.rect(48, tableTop - 2, 490, 14).fill('#E8E8E8');
    doc.fillColor('#000');
    for (const col of cols) {
        doc.text(col.label, col.x, tableTop, { width: col.w });
    }
    
    // Comp rows
    doc.font('Helvetica').fontSize(7);
    let y = tableTop + 16;
    let totalValue = 0;
    
    for (let i = 0; i < comps.length; i++) {
        const c = comps[i];
        if (i % 2 === 0) {
            doc.rect(48, y - 2, 490, 13).fill('#F5F5F5');
            doc.fillColor('#000');
        }
        
        doc.text(`${i + 1}`, cols[0].x, y, { width: cols[0].w });
        doc.text(c.address.substring(0, 30), cols[1].x, y, { width: cols[1].w });
        doc.text('$' + (c.marketValue || 0).toLocaleString(), cols[2].x, y, { width: cols[2].w });
        doc.text('$' + (c.improvValue || 0).toLocaleString(), cols[3].x, y, { width: cols[3].w });
        doc.text(String(c.sqft || '—'), cols[4].x, y, { width: cols[4].w });
        doc.text(String(c.yearBuilt || '—'), cols[5].x, y, { width: cols[5].w });
        doc.text(String(c.acres || '—'), cols[6].x, y, { width: cols[6].w });
        doc.text(c.nbhd || '—', cols[7].x, y, { width: cols[7].w });
        
        totalValue += (c.marketValue || 0);
        y += 14;
    }
    
    // Summary
    y += 8;
    const avg = Math.round(totalValue / comps.length);
    const median = comps.length > 0 ? comps[Math.floor(comps.length / 2)].marketValue : 0;
    
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text(`Comparable Properties: ${comps.length}`, 50, y);
    doc.text(`Average Market Value: $${avg.toLocaleString()}`, 50, y + 14);
    doc.text(`Median Market Value: $${median.toLocaleString()}`, 50, y + 28);
    doc.text(`Subject Appraised Value: $${(subject.assessedValue || 0).toLocaleString()}`, 50, y + 42);
    
    const diff = subject.assessedValue - avg;
    if (diff > 0) {
        doc.fillColor('#CC0000');
        doc.text(`Subject EXCEEDS average by: $${diff.toLocaleString()} (${((diff / avg) * 100).toFixed(1)}% above)`, 50, y + 60);
        doc.fillColor('#000');
    }
    
    y += 85;
    doc.font('Helvetica').fontSize(8);
    doc.text('Comp Selection Criteria:', 50, y);
    doc.text(`• Square footage: ±20% of subject (${Math.round(subject.sqft * 0.8)} – ${Math.round(subject.sqft * 1.2)} sq ft)`, 60, y + 14);
    doc.text(`• Year built: ±15 years of subject`, 60, y + 28);
    doc.text('• Same corridor / neighborhood area', 60, y + 42);
    doc.text('• Lower-valued comparable properties prioritized per TaxNet USA standard', 60, y + 56);
    
    // Footer
    doc.fontSize(7).fillColor('#666');
    doc.text('Comparable Property Analysis — TaxNet USA Standard Format', 50, 720, { align: 'center', width: 500 });
    doc.text('Source: Bexar County Appraisal District (BCAD) Public Records', 50, 732, { align: 'center', width: 500 });
    doc.fillColor('#000');
}

/**
 * Generate complete TaxNet-standard filing package
 */
async function generateTaxNetPackage(caseData, property, comps) {
    // Validate
    if (comps.length < 8) {
        throw new Error(`TaxNet validation failed: only ${comps.length} comps (minimum 8 required)`);
    }
    
    const caseId = caseData.case_id;
    const filename = `${caseId}-Filing-Package.pdf`;
    const filePath = path.join(FILING_DIR, filename);
    
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);
        
        // Section 1: Form 50-132
        renderForm50132(doc, caseData, property);
        
        // Section 2: Comparable Analysis
        renderCompAnalysis(doc, property, comps);
        
        // Section 3: Evidence summary (additional page if needed)
        doc.addPage();
        doc.fontSize(14).font('Helvetica-Bold').text('Supporting Evidence Summary', { align: 'center' });
        doc.moveDown(1);
        doc.fontSize(10).font('Helvetica');
        doc.text(`Case ID: ${caseId}`);
        doc.text(`Property: ${caseData.property_address}`);
        doc.text(`Owner: ${caseData.owner_name}`);
        doc.text(`County: ${capitalize(caseData.county)}`);
        doc.text(`Appraised Value: $${(property.assessedValue || 0).toLocaleString()}`);
        doc.moveDown(0.5);
        doc.text('Key Arguments:');
        doc.text(`1. The subject property at $${(property.assessedValue || 0).toLocaleString()} is assessed ${((property.assessedValue - comps.reduce((s,c) => s+c.marketValue, 0)/comps.length) / (comps.reduce((s,c) => s+c.marketValue, 0)/comps.length) * 100).toFixed(1)}% above the average of ${comps.length} comparable properties.`);
        doc.text(`2. Comparable properties on Scenic Loop Rd with similar square footage (${property.sqft} sf) are valued between $${comps[0].marketValue.toLocaleString()} and $${comps[comps.length-1].marketValue.toLocaleString()}.`);
        doc.text(`3. The property is ${property.notes || 'an older home requiring updates'}.`);
        if (property.acres && property.acres > 5) {
            doc.text(`4. Large acreage (${property.acres} acres) in this corridor does not proportionally increase improved property value — land use is limited.`);
        }
        
        doc.moveDown(1);
        doc.fontSize(8);
        doc.text('Filing Format: TaxNet USA Standard');
        doc.text(`Generated: ${new Date().toISOString().slice(0, 10)}`);
        doc.text(`Package ID: ${caseId}-TXNT-${Date.now().toString(36)}`);
        
        // Footer
        doc.fontSize(7).fillColor('#666');
        doc.text('Supporting Evidence — TaxNet USA Standard Format', 50, 720, { align: 'center', width: 500 });
        doc.fillColor('#000');
        
        doc.end();
        stream.on('finish', () => resolve({ filePath, filename, url: `/filing-packages/${filename}`, compsUsed: comps.length, format: 'taxnet_standard' }));
        stream.on('error', reject);
    });
}

function drawLabelValue(doc, label, value, x, y) {
    doc.font('Helvetica-Bold').fontSize(8).text(label, x, y, { continued: true });
    doc.font('Helvetica').text(' ' + value);
}

function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';
}

module.exports = { generateTaxNetPackage, validateComps, FILING_DIR };
