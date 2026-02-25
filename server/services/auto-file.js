/**
 * Auto-Filing System — prepares filing packages for property tax protests.
 * Generates pre-filled Form 50-132 (Notice of Protest) data and filing packages.
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const FILING_DIR = path.join(__dirname, '..', 'filing-packages');

/**
 * Prepare a complete filing data package for a case.
 */
async function prepareFilingPackage(caseData, propertyData, compResults) {
    await fs.promises.mkdir(FILING_DIR, { recursive: true });

    const filingData = {
        preparedAt: new Date().toISOString(),
        caseId: caseData.caseId,
        status: 'ready-to-file',

        // Form 50-132 fields
        form50132: {
            propertyOwner: caseData.ownerName,
            mailingAddress: caseData.propertyAddress, // Use property address as mailing
            propertyDescription: propertyData.address || caseData.propertyAddress,
            accountNumber: propertyData.accountId || caseData.pin || '',
            appraisalDistrict: detectDistrict(caseData.propertyAddress),
            taxYear: new Date().getFullYear(),
            protestReasons: [
                'Value is over market value',
                'Value is unequal compared with other properties'
            ],
            agentName: 'OverAssessed, LLC',
            agentAddress: 'San Antonio, TX',
            agentPhone: '(210) 760-7236',
            currentValue: propertyData.assessedValue,
            requestedValue: compResults.recommendedValue,
            supportingEvidence: 'Comparable sales analysis attached'
        },

        // Summary
        currentAssessedValue: propertyData.assessedValue,
        recommendedValue: compResults.recommendedValue,
        estimatedReduction: compResults.reduction,
        estimatedTaxSavings: compResults.estimatedSavings,
        comparablesCount: compResults.comps.length,

        // Checklist
        checklist: {
            propertyDataPulled: !!propertyData,
            compsIdentified: compResults.comps.length >= 3,
            evidencePacketGenerated: !!caseData.evidencePacketPath,
            formSigned: !!caseData.signature,
            readyToFile: !!caseData.signature && compResults.comps.length >= 3
        }
    };

    // Generate the filing package PDF (pre-filled Form 50-132 style)
    const pdfPath = await generateFilingPDF(caseData, propertyData, compResults, filingData);
    filingData.filingPdfPath = pdfPath;

    return filingData;
}

/**
 * Generate a pre-filled Form 50-132 (Notice of Protest) PDF.
 */
async function generateFilingPDF(caseData, propertyData, compResults, filingData) {
    const filename = `${(caseData.caseId || 'case').replace(/[^a-zA-Z0-9-]/g, '')}-Filing-Package.pdf`;
    const filepath = path.join(FILING_DIR, filename);

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'letter',
            margins: { top: 50, bottom: 50, left: 60, right: 60 }
        });

        const stream = fs.createWriteStream(filepath);
        doc.pipe(stream);

        const form = filingData.form50132;

        // ===== PAGE 1: NOTICE OF PROTEST (Form 50-132 style) =====
        doc.fontSize(10).fillColor('#333').font('Helvetica-Bold')
            .text('NOTICE OF PROTEST', { align: 'center' });
        doc.fontSize(8).fillColor('#666').font('Helvetica')
            .text('Form 50-132 — Property Tax Protest', { align: 'center' });
        doc.moveDown(0.5);

        // Appraisal district
        drawFormField(doc, 'Appraisal District:', form.appraisalDistrict);
        drawFormField(doc, 'Tax Year:', String(form.taxYear));
        doc.moveDown(0.5);

        // Section 1: Property Owner
        drawSectionHeader(doc, 'SECTION 1: PROPERTY OWNER INFORMATION');
        drawFormField(doc, 'Property Owner Name:', form.propertyOwner);
        drawFormField(doc, 'Mailing Address:', form.mailingAddress);
        doc.moveDown(0.3);

        // Section 2: Property Description
        drawSectionHeader(doc, 'SECTION 2: PROPERTY DESCRIPTION');
        drawFormField(doc, 'Property Address:', form.propertyDescription);
        drawFormField(doc, 'Account/Property ID Number:', form.accountNumber || '(to be provided)');
        doc.moveDown(0.3);

        // Section 3: Reason for Protest
        drawSectionHeader(doc, 'SECTION 3: REASON FOR PROTEST');
        form.protestReasons.forEach(reason => {
            doc.fontSize(10).font('Helvetica')
                .text(`  ☑  ${reason}`, { indent: 20 });
        });
        doc.moveDown(0.3);

        // Section 4: Requested Value
        drawSectionHeader(doc, 'SECTION 4: OPINION OF VALUE');
        drawFormField(doc, 'Current Appraised Value:', `$${(form.currentValue || 0).toLocaleString()}`);
        drawFormField(doc, 'Requested/Opinion of Value:', `$${(form.requestedValue || 0).toLocaleString()}`);
        drawFormField(doc, 'Potential Reduction:', `$${(filingData.estimatedReduction || 0).toLocaleString()}`);
        doc.moveDown(0.3);

        // Section 5: Agent
        drawSectionHeader(doc, 'SECTION 5: AGENT INFORMATION');
        drawFormField(doc, 'Agent Name:', form.agentName);
        drawFormField(doc, 'Agent Address:', form.agentAddress);
        drawFormField(doc, 'Agent Phone:', form.agentPhone);
        drawFormField(doc, 'Supporting Evidence:', form.supportingEvidence);
        doc.moveDown(0.5);

        // Signature line
        doc.moveDown(2);
        doc.moveTo(60, doc.y).lineTo(300, doc.y).stroke();
        doc.fontSize(8).fillColor('#666').text('Signature of Property Owner or Agent', 60);
        doc.moveDown(1);
        doc.moveTo(60, doc.y).lineTo(300, doc.y).stroke();
        doc.text('Date');

        // ===== PAGE 2: FILING CHECKLIST =====
        doc.addPage();
        doc.fontSize(14).fillColor('#333').font('Helvetica-Bold')
            .text('Filing Checklist', { align: 'center' });
        doc.moveDown(1);

        const checklist = [
            ['Property data retrieved', filingData.checklist.propertyDataPulled],
            ['Comparable properties identified (3+)', filingData.checklist.compsIdentified],
            ['Evidence packet generated', filingData.checklist.evidencePacketGenerated],
            ['Form 50-162 signed by owner', filingData.checklist.formSigned],
            ['Ready to file', filingData.checklist.readyToFile]
        ];

        checklist.forEach(([item, done]) => {
            const icon = done ? '✅' : '⬜';
            doc.fontSize(11).fillColor('#333').font('Helvetica')
                .text(`${icon}  ${item}`);
            doc.moveDown(0.3);
        });

        doc.moveDown(2);
        doc.fontSize(10).fillColor('#666').font('Helvetica')
            .text(`Case: ${caseData.caseId}`, { align: 'center' });
        doc.text(`Prepared: ${new Date().toLocaleDateString()}`, { align: 'center' });
        doc.text('OverAssessed — San Antonio, Texas', { align: 'center' });

        doc.end();
        stream.on('finish', () => resolve(filepath));
        stream.on('error', reject);
    });
}

function drawSectionHeader(doc, text) {
    const y = doc.y;
    doc.rect(60, y, 492, 18).fill('#6c5ce7');
    doc.fontSize(9).fillColor('white').font('Helvetica-Bold')
        .text(text, 70, y + 4, { width: 472 });
    doc.y = y + 24;
}

function drawFormField(doc, label, value) {
    const y = doc.y;
    doc.fontSize(9).fillColor('#666').font('Helvetica')
        .text(label, 70, y, { width: 160, continued: false });
    doc.fontSize(10).fillColor('#333').font('Helvetica-Bold')
        .text(value || '—', 230, y, { width: 310 });
    doc.y = Math.max(doc.y, y + 18);
}

function detectDistrict(address) {
    const addr = (address || '').toLowerCase();
    if (addr.includes('houston') || addr.includes('harris')) return 'Harris County Appraisal District (HCAD)';
    if (addr.includes('austin') || addr.includes('travis')) return 'Travis County Appraisal District (TCAD)';
    return 'Bexar County Appraisal District (BCAD)';
}

/**
 * Check annual monitoring for all enrolled clients.
 * Placeholder — will integrate with county assessment APIs when available.
 */
async function checkAnnualMonitoring() {
    console.log('[AnnualMonitoring] Starting annual monitoring check...');
    try {
        const { supabaseAdmin, isSupabaseEnabled } = require('../lib/supabase');
        if (!isSupabaseEnabled()) {
            console.log('[AnnualMonitoring] Supabase not enabled, skipping.');
            return;
        }

        // Query all clients with annual_monitoring=true
        const { data: clients, error } = await supabaseAdmin
            .from('clients')
            .select('id, name, email, phone')
            .eq('annual_monitoring', true);

        if (error) throw error;
        console.log(`[AnnualMonitoring] Found ${clients.length} clients enrolled in monitoring.`);

        for (const client of clients) {
            // Get their properties
            const { data: properties } = await supabaseAdmin
                .from('properties')
                .select('id, address, state')
                .eq('client_id', client.id);

            for (const prop of (properties || [])) {
                // PLACEHOLDER: Check if new assessment notices have been published
                console.log(`[AnnualMonitoring] Would check assessment for ${prop.address} (client: ${client.name})`);

                // When real data is available, the logic would be:
                // 1. Fetch new assessed value from county API
                // 2. Compare with previous value
                // 3. If increased, auto-create appeal and notify client:
                //
                // const newValue = await fetchNewAssessment(prop);
                // if (newValue > previousValue) {
                //     const { data: appeal } = await supabaseAdmin.from('appeals').insert({...}).select().single();
                //     await supabaseAdmin.from('annual_monitoring').insert({
                //         client_id: client.id, property_id: prop.id,
                //         tax_year: new Date().getFullYear(),
                //         previous_value: previousValue, new_value: newValue,
                //         change_pct: ((newValue - previousValue) / previousValue * 100),
                //         auto_filed: true, appeal_id: appeal.id, status: 'auto-filed'
                //     });
                //     // Notify client
                // }
            }
        }

        console.log('[AnnualMonitoring] Check complete.');
    } catch (err) {
        console.error('[AnnualMonitoring] Error:', err.message);
    }
}

module.exports = {
    prepareFilingPackage,
    generateFilingPDF,
    checkAnnualMonitoring,
    FILING_DIR
};
