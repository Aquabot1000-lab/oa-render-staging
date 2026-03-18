/**
 * Evidence Packet Generator — Professional one-page PDF evidence packets
 * Branded with OverAssessed purple accent. Designed for partner firm review.
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const EVIDENCE_DIR = path.join(__dirname, '..', 'evidence-packets');

// Brand colors
const PURPLE = '#6c5ce7';
const PURPLE_LIGHT = '#f0eeff';
const PURPLE_MID = '#d5d0f5';
const GREEN = '#00b894';
const GREEN_LIGHT = '#e6faf4';
const RED_LIGHT = '#ffeaea';
const TEXT_DARK = '#1a1a2e';
const TEXT_MED = '#4a4a68';
const TEXT_MUTED = '#7c7c96';
const ROW_ALT = '#f7f7fc';
const WHITE = '#ffffff';

/**
 * Generate a professional one-page evidence packet PDF.
 */
async function generateEvidencePacket(caseData, propertyData, compResults) {
    await fs.promises.mkdir(EVIDENCE_DIR, { recursive: true });

    const filename = `${(caseData.caseId || 'case').replace(/[^a-zA-Z0-9-]/g, '')}-Evidence-Packet.pdf`;
    const filepath = path.join(EVIDENCE_DIR, filename);

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'letter',
            margins: { top: 28, bottom: 24, left: 36, right: 36 },
            info: {
                Title: `Evidence Packet — ${caseData.caseId}`,
                Author: 'OverAssessed LLC',
                Subject: `Property Tax Protest Evidence — ${caseData.propertyAddress}`
            }
        });

        const stream = fs.createWriteStream(filepath);
        doc.pipe(stream);

        const PW = 612; // page width
        const CW = PW - 72; // content width (540)
        const LM = 36; // left margin

        try {
            // ===== HEADER BAR =====
            doc.rect(0, 0, PW, 32).fill(PURPLE);
            doc.fontSize(11).fillColor(WHITE).font('Helvetica-Bold')
                .text('OVERASSESSED', LM + 4, 9);
            doc.fontSize(7.5).fillColor(WHITE).font('Helvetica')
                .text('LLC', LM + 100, 12);
            doc.fontSize(7.5).fillColor(WHITE).font('Helvetica')
                .text('PROPERTY TAX PROTEST EVIDENCE PACKET', PW - 36 - 230, 12, { width: 230, align: 'right' });
            doc.y = 38;

            // ===== PROPERTY INFO ROW =====
            const infoY = doc.y;
            doc.rect(LM, infoY, CW, 36).fill(PURPLE_LIGHT);
            doc.rect(LM, infoY, CW, 36).strokeColor(PURPLE_MID).lineWidth(0.5).stroke();

            const col1 = LM + 8;
            const col2 = LM + 180;
            const col3 = LM + 370;

            doc.fontSize(6.5).fillColor(TEXT_MUTED).font('Helvetica').text('PROPERTY OWNER', col1, infoY + 4);
            doc.fontSize(8.5).fillColor(TEXT_DARK).font('Helvetica-Bold').text(caseData.ownerName || '—', col1, infoY + 13, { width: 165 });

            doc.fontSize(6.5).fillColor(TEXT_MUTED).font('Helvetica').text('PROPERTY ADDRESS', col2, infoY + 4);
            doc.fontSize(8.5).fillColor(TEXT_DARK).font('Helvetica-Bold').text(caseData.propertyAddress || '—', col2, infoY + 13, { width: 180 });

            doc.fontSize(6.5).fillColor(TEXT_MUTED).font('Helvetica').text('CASE ID', col3, infoY + 4);
            doc.fontSize(8.5).fillColor(TEXT_DARK).font('Helvetica-Bold').text(caseData.caseId || '—', col3, infoY + 13);

            doc.fontSize(6.5).fillColor(TEXT_MUTED).font('Helvetica').text('DATE', col3 + 90, infoY + 4);
            doc.fontSize(8.5).fillColor(TEXT_DARK).font('Helvetica-Bold').text(new Date().toLocaleDateString(), col3 + 90, infoY + 13);

            doc.y = infoY + 42;

            // ===== VALUE SUMMARY BOX =====
            const sumY = doc.y;
            const sumH = 52;
            const boxW = CW / 4;

            // Current Assessed
            doc.rect(LM, sumY, boxW, sumH).fill(WHITE);
            doc.rect(LM, sumY, boxW, sumH).strokeColor('#e0e0e8').lineWidth(0.5).stroke();
            doc.fontSize(6).fillColor(TEXT_MUTED).font('Helvetica').text('CURRENT ASSESSED', LM + 6, sumY + 6, { width: boxW - 12 });
            doc.fontSize(13).fillColor(TEXT_DARK).font('Helvetica-Bold')
                .text(`$${(propertyData.assessedValue || 0).toLocaleString()}`, LM + 6, sumY + 18, { width: boxW - 12 });

            // Recommended Value
            doc.rect(LM + boxW, sumY, boxW, sumH).fill(WHITE);
            doc.rect(LM + boxW, sumY, boxW, sumH).strokeColor('#e0e0e8').lineWidth(0.5).stroke();
            doc.fontSize(6).fillColor(TEXT_MUTED).font('Helvetica').text('RECOMMENDED VALUE', LM + boxW + 6, sumY + 6, { width: boxW - 12 });
            doc.fontSize(13).fillColor('#0984e3').font('Helvetica-Bold')
                .text(`$${(compResults.recommendedValue || 0).toLocaleString()}`, LM + boxW + 6, sumY + 18, { width: boxW - 12 });

            // Potential Reduction
            doc.rect(LM + boxW * 2, sumY, boxW, sumH).fill(WHITE);
            doc.rect(LM + boxW * 2, sumY, boxW, sumH).strokeColor('#e0e0e8').lineWidth(0.5).stroke();
            doc.fontSize(6).fillColor(TEXT_MUTED).font('Helvetica').text('POTENTIAL REDUCTION', LM + boxW * 2 + 6, sumY + 6, { width: boxW - 12 });
            doc.fontSize(13).fillColor(GREEN).font('Helvetica-Bold')
                .text(`$${(compResults.reduction || 0).toLocaleString()}`, LM + boxW * 2 + 6, sumY + 18, { width: boxW - 12 });

            // Estimated Tax Savings — PROMINENT
            doc.rect(LM + boxW * 3, sumY, boxW, sumH).fill('#00b894');
            doc.fontSize(6).fillColor(WHITE).font('Helvetica').text('EST. TAX SAVINGS', LM + boxW * 3 + 6, sumY + 6, { width: boxW - 12 });
            doc.fontSize(15).fillColor(WHITE).font('Helvetica-Bold')
                .text(`$${(compResults.estimatedSavings || 0).toLocaleString()}`, LM + boxW * 3 + 6, sumY + 17, { width: boxW - 12 });
            doc.fontSize(7).fillColor(WHITE).font('Helvetica')
                .text('/year', LM + boxW * 3 + 6, sumY + 36, { width: boxW - 12 });

            doc.y = sumY + sumH + 8;

            // ===== COMPARABLE PROPERTIES TABLE =====
            doc.fontSize(9).fillColor(TEXT_DARK).font('Helvetica-Bold').text('COMPARABLE PROPERTIES', LM, doc.y);
            doc.y += 4;

            const tableX = LM;
            const colWidths = [170, 72, 72, 52, 48, 56, 36];
            // Headers: Address, Assessed, Adjusted, Sq Ft, Yr Built, $/SqFt, Score
            const headers = ['Address', 'Assessed', 'Adjusted', 'Sq Ft', 'Yr Built', '$/SqFt', 'Score'];

            const thY = doc.y;
            doc.rect(tableX, thY, CW, 14).fill(PURPLE);
            doc.fontSize(6.5).fillColor(WHITE).font('Helvetica-Bold');
            let colX = tableX + 4;
            headers.forEach((h, i) => {
                const align = i === 0 ? 'left' : 'right';
                doc.text(h, colX, thY + 3.5, { width: colWidths[i] - 8, align });
                colX += colWidths[i];
            });
            doc.y = thY + 15;

            const comps = compResults.comps || [];
            const assessedVal = propertyData.assessedValue || 0;

            comps.forEach((comp, i) => {
                const rowY = doc.y;
                const rowH = 13;
                if (i % 2 === 0) doc.rect(tableX, rowY, CW, rowH).fill(ROW_ALT);

                doc.fontSize(6.5).font('Helvetica').fillColor(TEXT_DARK);
                colX = tableX + 4;

                // Address (truncated)
                const addr = (comp.address || '').length > 38 ? (comp.address || '').substring(0, 36) + '…' : (comp.address || '');
                doc.text(addr, colX, rowY + 3, { width: colWidths[0] - 8 });
                colX += colWidths[0];

                // Assessed
                doc.text(`$${(comp.assessedValue || 0).toLocaleString()}`, colX, rowY + 3, { width: colWidths[1] - 8, align: 'right' });
                colX += colWidths[1];

                // Adjusted (color-coded)
                const adjColor = (comp.adjustedValue || 0) < assessedVal ? GREEN : '#e17055';
                doc.fillColor(adjColor).font('Helvetica-Bold');
                doc.text(`$${(comp.adjustedValue || 0).toLocaleString()}`, colX, rowY + 3, { width: colWidths[2] - 8, align: 'right' });
                colX += colWidths[2];

                doc.fillColor(TEXT_DARK).font('Helvetica');
                // Sq Ft
                doc.text(comp.sqft ? comp.sqft.toLocaleString() : '—', colX, rowY + 3, { width: colWidths[3] - 8, align: 'right' });
                colX += colWidths[3];

                // Year Built
                doc.text(comp.yearBuilt || '—', colX, rowY + 3, { width: colWidths[4] - 8, align: 'right' });
                colX += colWidths[4];

                // $/SqFt
                doc.text(comp.pricePerSqft ? `$${comp.pricePerSqft}` : '—', colX, rowY + 3, { width: colWidths[5] - 8, align: 'right' });
                colX += colWidths[5];

                // Score
                doc.font('Helvetica-Bold').fillColor(PURPLE);
                doc.text(`${comp.score}`, colX, rowY + 3, { width: colWidths[6] - 8, align: 'right' });

                doc.y = rowY + rowH;
            });

            // Thin line under table
            doc.moveTo(tableX, doc.y).lineTo(tableX + CW, doc.y).strokeColor('#e0e0e8').lineWidth(0.5).stroke();
            doc.y += 8;

            // ===== EQUAL & UNIFORM SECTION (if applicable) =====
            if (compResults.euAnalysis && compResults.euAnalysis.recommendation !== 'INSUFFICIENT_DATA' && compResults.euAnalysis.euTargetValue) {
                const eu = compResults.euAnalysis;
                const isPrimary = compResults.primaryStrategy === 'equal_and_uniform';

                doc.fontSize(9).fillColor(TEXT_DARK).font('Helvetica-Bold')
                    .text(`EQUAL & UNIFORM ANALYSIS (§42.26)${isPrimary ? '  ★ PRIMARY STRATEGY' : ''}`, LM, doc.y);
                doc.y += 4;

                // Compact 3-column metrics
                const euY = doc.y;
                const euBoxW = CW / 3;
                const euH = 28;

                doc.rect(LM, euY, euBoxW - 2, euH).fill(PURPLE_LIGHT);
                doc.fontSize(5.5).fillColor(TEXT_MUTED).font('Helvetica').text('MEDIAN ASSESSMENT RATIO', LM + 6, euY + 3);
                doc.fontSize(12).fillColor(PURPLE).font('Helvetica-Bold').text(`${eu.medianRatio}`, LM + 6, euY + 12);

                doc.rect(LM + euBoxW, euY, euBoxW - 2, euH).fill(PURPLE_LIGHT);
                doc.fontSize(5.5).fillColor(TEXT_MUTED).font('Helvetica').text('E&U TARGET VALUE', LM + euBoxW + 6, euY + 3);
                doc.fontSize(12).fillColor('#0984e3').font('Helvetica-Bold').text(`$${eu.euTargetValue.toLocaleString()}`, LM + euBoxW + 6, euY + 12);

                const euReduction = Math.max(0, (eu.subjectAssessedValue || 0) - eu.euTargetValue);
                doc.rect(LM + euBoxW * 2, euY, euBoxW, euH).fill(PURPLE_LIGHT);
                doc.fontSize(5.5).fillColor(TEXT_MUTED).font('Helvetica').text('E&U REDUCTION', LM + euBoxW * 2 + 6, euY + 3);
                doc.fontSize(12).fillColor(GREEN).font('Helvetica-Bold').text(`$${euReduction.toLocaleString()}`, LM + euBoxW * 2 + 6, euY + 12);

                doc.y = euY + euH + 6;

                // E&U comp ratios table (compact, max 6 rows)
                const euComps = (eu.compAnalysis || []).slice(0, 6);
                if (euComps.length > 0) {
                    const euTX = LM;
                    const euColW = [175, 95, 95, 55, 50];
                    const euThY = doc.y;
                    doc.rect(euTX, euThY, CW, 12).fill(PURPLE);
                    doc.fontSize(5.5).fillColor(WHITE).font('Helvetica-Bold');
                    let euCX = euTX + 4;
                    ['Address', 'Assessed', 'Sale Price', 'Ratio', 'Status'].forEach((h, i) => {
                        doc.text(h, euCX, euThY + 3, { width: euColW[i] - 6, align: i === 0 ? 'left' : 'right' });
                        euCX += euColW[i];
                    });
                    doc.y = euThY + 13;

                    euComps.forEach((comp, i) => {
                        const rY = doc.y;
                        if (i % 2 === 0) doc.rect(euTX, rY, CW, 11).fill(ROW_ALT);
                        doc.fontSize(5.5).fillColor(TEXT_DARK).font('Helvetica');
                        euCX = euTX + 4;
                        const addr = (comp.address || '').substring(0, 35);
                        doc.text(addr, euCX, rY + 2.5, { width: euColW[0] - 6 });
                        euCX += euColW[0];
                        doc.text(`$${(comp.assessed_value || 0).toLocaleString()}`, euCX, rY + 2.5, { width: euColW[1] - 6, align: 'right' });
                        euCX += euColW[1];
                        doc.text(`$${(comp.sale_price || 0).toLocaleString()}`, euCX, rY + 2.5, { width: euColW[2] - 6, align: 'right' });
                        euCX += euColW[2];
                        doc.fillColor(comp.excluded ? '#e17055' : TEXT_DARK).font('Helvetica-Bold');
                        doc.text(comp.ratio !== null ? `${comp.ratio}` : 'N/A', euCX, rY + 2.5, { width: euColW[3] - 6, align: 'right' });
                        euCX += euColW[3];
                        doc.fillColor(comp.excluded ? '#e17055' : GREEN).fontSize(5);
                        doc.text(comp.excluded ? 'Excluded' : 'Included', euCX, rY + 2.5, { width: euColW[4] - 6, align: 'right' });
                        doc.y = rY + 11;
                    });
                    doc.y += 4;
                }
            }

            // ===== METHODOLOGY =====
            doc.fontSize(9).fillColor(TEXT_DARK).font('Helvetica-Bold').text('METHODOLOGY', LM, doc.y);
            doc.y += 3;
            doc.fontSize(6.5).fillColor(TEXT_MED).font('Helvetica')
                .text(compResults.methodology || 'Market value determined through comparable sales analysis with adjustments for property characteristics.', LM, doc.y, { width: CW, lineGap: 1 });
            doc.y += 6;

            // ===== RECOMMENDATION BADGE =====
            const isRecommended = (compResults.estimatedSavings || 0) > 0;
            const badgeY = doc.y;
            const badgeColor = isRecommended ? GREEN : '#e17055';
            const badgeBg = isRecommended ? GREEN_LIGHT : RED_LIGHT;
            const badgeText = isRecommended ? '✓  PROTEST RECOMMENDED' : '✗  NOT RECOMMENDED';

            doc.rect(LM, badgeY, CW, 20).fill(badgeBg);
            doc.rect(LM, badgeY, 4, 20).fill(badgeColor); // left accent bar
            doc.fontSize(9).fillColor(badgeColor).font('Helvetica-Bold')
                .text(badgeText, LM + 14, badgeY + 5.5);

            // Strategy label
            const strategyLabel = compResults.primaryStrategy === 'equal_and_uniform' ? 'Equal & Uniform (§42.26)' : 'Market Value Approach';
            doc.fontSize(7).fillColor(TEXT_MUTED).font('Helvetica')
                .text(`Strategy: ${strategyLabel}`, LM + 300, badgeY + 6.5, { width: CW - 310, align: 'right' });

            doc.y = badgeY + 26;

            // ===== SUMMARY ARGUMENT =====
            doc.fontSize(9).fillColor(TEXT_DARK).font('Helvetica-Bold').text('SUMMARY ARGUMENT', LM, doc.y);
            doc.y += 3;
            doc.fontSize(6.5).fillColor(TEXT_MED).font('Helvetica')
                .text(buildSummaryArgument(caseData, propertyData, compResults), LM, doc.y, { width: CW, lineGap: 1 });

            // ===== FOOTER =====
            // Fixed position footer at bottom
            const footerY = 756; // letter height (792) - bottom margin - footer height
            doc.moveTo(LM, footerY).lineTo(LM + CW, footerY).strokeColor(PURPLE_MID).lineWidth(0.5).stroke();
            doc.fontSize(6).fillColor(TEXT_MUTED).font('Helvetica')
                .text('Prepared by OverAssessed LLC  |  overassessed.ai  |  Confidential', LM, footerY + 4, { width: CW, align: 'center' });
            doc.fontSize(5.5).fillColor(TEXT_MUTED).font('Helvetica')
                .text('All data sourced from publicly available appraisal district records. This document is for use in property tax protest proceedings.', LM, footerY + 13, { width: CW, align: 'center' });

        } catch (err) {
            console.error('[EvidenceGen] PDF creation error:', err.message);
        }

        doc.end();
        stream.on('finish', () => resolve(filepath));
        stream.on('error', reject);
    });
}

function buildSummaryArgument(caseData, propertyData, compResults) {
    const compsBelow = (compResults.comps || []).filter(c => c.adjustedValue < propertyData.assessedValue);
    return `The property at ${caseData.propertyAddress} is currently assessed at ` +
        `$${(propertyData.assessedValue || 0).toLocaleString()} for the ${new Date().getFullYear()} tax year. ` +
        `Analysis of ${(compResults.comps || []).length} comparable properties shows ` +
        `${compsBelow.length} assessed below the subject after adjustments for size, age, and lot characteristics. ` +
        `The recommended value of $${(compResults.recommendedValue || 0).toLocaleString()} represents a reduction of ` +
        `$${(compResults.reduction || 0).toLocaleString()}, yielding estimated annual tax savings of ` +
        `$${(compResults.estimatedSavings || 0).toLocaleString()}.`;
}

module.exports = {
    generateEvidencePacket,
    EVIDENCE_DIR
};
