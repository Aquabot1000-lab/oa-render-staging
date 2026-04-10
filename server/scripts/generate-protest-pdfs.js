const fs = require('fs');
const PDFDocument = require('pdfkit');
const path = require('path');

const clientData = {
    'Anthony Pettitt': {
        name: 'Anthony Pettitt',
        address: '3125 Overton Park Dr',
        county: 'Tarrant County',
        parcel_id: '03086925',
        assessed_value: 909091,
        assessed_source: 'CAD 2025',
        assessed_url: 'https://www.taxnetusa.com/clientdb/Property.aspx?cid=XXX&prop_id=03086925&year=2025', // Placeholder URL
        rentcast_avm: null, // Not provided in PDF
        proposed_value: 844838,
        over_assessment: -64253, // Difference between CAD value and indicated value
        tax_savings: null, // Not provided in PDF, would need tax rate
        comps: [
            { address: '3908 Hartwood Dr', price: 650000, sqft: 1618, year: 1961, dist: '0.48mi', score: null, reason: '1.29% Size Adj, 7.14% Land Adj, 16.49% Feature Adj, 4.62% Pool Adj' },
            { address: '3233 Spanish Oak Dr', price: 600000, sqft: 2002, year: 1956, dist: '0.28mi', score: null, reason: '0.91% Size Adj, 16.07% Land Adj, 17.72% Feature Adj, 5.00% Pool Adj' },
            { address: '4021 Glenwood Dr', price: 599665, sqft: 2204, year: 1959, dist: '0.30mi', score: null, reason: '0.71% Size Adj, 16.14% Land Adj, 17.67% Feature Adj, 5.00% Pool Adj' },
            { address: '3201 Chaparral Ln', price: 609000, sqft: 1988, year: 1956, dist: '0.08mi', score: null, reason: '0.84% Size Adj, 14.36% Land Adj, 17.68% Feature Adj, 4.93% Pool Adj' },
            { address: '3821 Trailwood Ln', price: 562828, sqft: 2912, year: 1965, dist: '0.45mi', score: null, reason: '0.21% Size Adj, 23.74% Land Adj, 18.52% Feature Adj, 5.33% Pool Adj' },
            { address: '3109 Overton Park Dr', price: 655800, sqft: 4348, year: 1961, dist: '0.07mi', score: null, reason: '0.36% Size Adj, 7.68% Land Adj, 19.00% Feature Adj' },
            { address: '3224 Spanish Oak Dr', price: 620760, sqft: 2128, year: 1956, dist: '0.24mi', score: null, reason: '0.23% Size Adj, 13.86% Land Adj, 17.39% Feature Adj, 4.83% Pool Adj' },
            { address: '3808 Glenwood Dr', price: 675000, sqft: 2410, year: 1955, dist: '0.55mi', score: null, reason: '0.11% Size Adj, 9.48% Land Adj, 15.80% Feature Adj, 25.16% Total Adj' },
            { address: '3117 Preston Hollow Rd', price: 683000, sqft: 2242, year: 1962, dist: '0.34mi', score: null, reason: '0.05% Size Adj, 4.84% Land Adj, 15.00% Feature Adj, 4.39% Pool Adj' },
            { address: '3824 Lynncrest Dr', price: 562039, sqft: 2564, year: 1954, dist: '0.77mi', score: null, reason: '0.00% Size Adj, 26.91% Land Adj, 19.00% Feature Adj, 5.34% Pool Adj' },
            { address: '3313 Marquette Ct', price: 633800, sqft: 2768, year: 1956, dist: '0.30mi', score: null, reason: '0.02% Size Adj, 12.62% Land Adj, 16.94% Feature Adj, 4.73% Pool Adj' },
            { address: '3120 Wild Plum Dr', price: 623700, sqft: 2074, year: 1957, dist: '0.26mi', score: null, reason: '0.13% Size Adj, 14.73% Land Adj, 17.18% Feature Adj, 4.81% Pool Adj' }
        ],
        recommendation: 'N/A',
        recommendation_reason: 'The CAD market value of $909,091 is higher than the indicated value of $844,838 based on 15 comparable sales. The median adjusted comparable sale price supports the indicated value. The property appears to be over-assessed by approximately 7.07%.',
        status: 'READY FOR REVIEW',
        storage_proof: { property_id: 'TEMP_ID_FOR_ANTHONY_PETTITT', tables: ['properties', 'clients'] } // Placeholder IDs
    }
};

function safeFormat(value, fallback = 'N/A') {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'number' && isNaN(value)) return fallback;
    return String(value);
}

function formatCurrency(amount) {
    if (amount === null || amount === undefined) return 'N/A';
    return '$' + Number(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatYear(year) {
    return year !== null && year !== undefined && year !== '' ? String(year) : 'N/A';
}

function formatSqft(sqft) {
    return sqft ? String(sqft.toLocaleString()) : 'N/A';
}

function createPDF(clientName, data) {
    const doc = new PDFDocument({
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        size: 'A4',
        autoFirstPage: false
    });

    const filename = `${clientName.replace(/ /g, '_').toLowerCase()}_protest_package.pdf`;
    const filePath = path.join('/tmp', filename);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // --- Document Setup ---
    doc.fontSize(16).fillColor('000000').font('Helvetica-Bold').text('OVERASSED PROPERTY TAX PROTEST REVIEW PACKAGE', { align: 'center' }).moveDown(0.5);
    doc.fontSize(12).fillColor('555555').font('Helvetica').text(`Date Generated: ${new Date().toLocaleDateString()}`, { align: 'center' }).moveDown(1);

    // --- Section 1: Subject Property ---
    doc.addPage().fontSize(14).font('Helvetica-Bold').text('1. SUBJECT PROPERTY', { underline: true }).moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Name: ${safeFormat(data.name)}`);
    doc.text(`Address: ${safeFormat(data.address)}`);
    doc.text(`County: ${safeFormat(data.county)}`);
    doc.text(`Parcel / Account ID: ${safeFormat(data.parcel_id)}`);
    doc.text(`Official CAD Value: ${formatCurrency(data.assessed_value)}`);
    
    const landValue = data.county_assessed?.land;
    const improvementValue = data.county_assessed?.improvement;
    const ownerName = data.county_assessed?.owner;
    const assessedSource = data.assessed_source;
    const assessedUrl = data.assessed_url;

    doc.text(`Breakdown: Land ${formatCurrency(landValue)} + Improvement ${formatCurrency(improvementValue)}`);
    doc.text(`Owner on File: ${safeFormat(ownerName)}`); 
    doc.text(`Source: ${safeFormat(assessedSource)}`);
    if (assessedUrl) {
        doc.fillColor('0000FF').text(`Verification URL: ${assessedUrl}`, { link: assessedUrl, underline: true });
        doc.fillColor('000000'); 
    }
    doc.moveDown(1);

    // --- Section 2: Engine Valuation ---
    doc.fontSize(14).font('Helvetica-Bold').text('2. ENGINE VALUATION', { underline: true }).moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(`RentCast AVM: ${formatCurrency(data.rentcast_avm)}`);
    doc.text(`Proposed Protest Value: ${formatCurrency(data.proposed_value)}`);
    let overAssessmentDisplay = data.over_assessment !== null && data.over_assessment !== undefined ? formatCurrency(data.over_assessment) : 'N/A';
    let overAssessmentPctDisplay = (data.assessed_value && data.assessed_value !== 0) ? `${((data.over_assessment / data.assessed_value) * 100).toFixed(1)}%` : 'N/A';
    if (overAssessmentPctDisplay === 'N/A' || overAssessmentDisplay === 'N/A') overAssessmentPctDisplay = 'N/A';
    else if (data.over_assessment < 0) overAssessmentPctDisplay = `(${(Math.abs(data.over_assessment) / data.assessed_value * 100).toFixed(1)}%)`;
    else overAssessmentPctDisplay = `${((data.over_assessment / data.assessed_value) * 100).toFixed(1)}%`;
    
    doc.text(`Over-Assessment: ${overAssessmentDisplay} (${overAssessmentPctDisplay})`);
    doc.text(`Estimated Annual Tax Savings: ${formatCurrency(data.tax_savings)}`);
    doc.moveDown(1);

    // --- Section 3: Comparables ---
    if (data.comps && data.comps.length > 0) {
        doc.fontSize(14).font('Helvetica-Bold').text('3. COMPARABLES (Real Sales)', { underline: true }).moveDown(0.5);
        doc.fontSize(9).font('Courier');
        
        const colWidths = [25, 110, 70, 50, 40, 50, 50, 155]; 
        const startX = 50;
        let currentY = doc.y;

        doc.font('Helvetica-Bold').fillColor('333333');
        let tempX = startX;
        ['#', 'Address', 'Price', 'Sqft', 'Year', 'Dist', 'Score', 'Reason'].forEach((header, i) => {
            doc.text(safeFormat(header), tempX, currentY, { width: colWidths[i], align: 'center', continued: true });
            tempX += colWidths[i];
        });
        doc.moveDown(0.2);
        doc.font('Courier').fillColor('000000');

        for (const comp of data.comps) {
            currentY = doc.y;
            // Check if a new page is needed before drawing the row
            if (currentY + 25 > doc.page.height - doc.page.margins.bottom) {
                doc.addPage();
                currentY = doc.y; // Reset y to the top of the new page
                // Redraw headers on new page
                doc.font('Helvetica-Bold').fillColor('333333');
                tempX = startX;
                ['#', 'Address', 'Price', 'Sqft', 'Year', 'Dist', 'Score', 'Reason'].forEach((header, i) => {
                    doc.text(safeFormat(header), tempX, currentY, { width: colWidths[i], align: 'center', continued: true });
                    tempX += colWidths[i];
                });
                doc.moveDown(0.2);
                doc.font('Courier').fillColor('000000');
            }

            let x = startX;
            doc.text(safeFormat(comp.score), x, currentY, { width: colWidths[0], align: 'center', continued: true }); x += colWidths[0];
            doc.text(safeFormat(comp.address), x, currentY, { width: colWidths[1], align: 'left', continued: true }); x += colWidths[1];
            doc.text(formatCurrency(comp.price), x, currentY, { width: colWidths[2], align: 'right', continued: true }); x += colWidths[2];
            doc.text(safeFormatSqft(comp.sqft), x, currentY, { width: colWidths[3], align: 'center', continued: true }); x += colWidths[3];
            doc.text(safeFormatYear(comp.year), x, currentY, { width: colWidths[4], align: 'center', continued: true }); x += colWidths[4];
            doc.text(safeFormat(comp.dist), x, currentY, { width: colWidths[5], align: 'center', continued: true }); x += colWidths[5];
            doc.text(safeFormat(comp.score), x, currentY, { width: colWidths[6], align: 'center', continued: true }); x += colWidths[6];
            // Safely format the reason, truncating if necessary and adding ellipsis
            const reasonText = safeFormat(comp.reason);
            const maxReasonLength = 110; // Max characters for reason column
            doc.text(reasonText.length > maxReasonLength ? reasonText.substring(0, maxReasonLength) + '...' : reasonText, x, currentY, { width: colWidths[7], align: 'left' });
            doc.moveDown(0.2);
        }
        doc.moveDown(1);
    } else {
        doc.fontSize(10).font('Helvetica').text('No comparable sales data available for this property.');
        doc.moveDown(1);
    }

    // --- Section 4: Final Recommendation ---
    doc.fontSize(14).font('Helvetica-Bold').text('4. FINAL RECOMMENDATION', { underline: true }).moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Protest Value: ${formatCurrency(data.proposed_value)}`);
    doc.text(`Justification: ${safeFormat(data.recommendation_reason)}`);
    doc.moveDown(1);

    // --- Section 5: Status ---
    doc.fontSize(14).font('Helvetica-Bold').text('5. STATUS', { underline: true }).moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    const statusColor = data.status === 'READY FOR REVIEW' ? '008000' : 'FF0000';
    doc.fillColor(statusColor).text(safeFormat(data.status));
    doc.fillColor('000000'); // Reset color
    if (data.status !== 'READY FOR REVIEW' && data.status_blocker) {
        doc.text(`Blocker: ${safeFormat(data.status_blocker)}`);
    }
    doc.moveDown(1);

    // --- Section 6: Storage Proof ---
    doc.fontSize(14).font('Helvetica-Bold').text('6. DATA STORAGE', { underline: true }).moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Supabase Property ID: ${safeFormat(data.storage_proof.property_id)}`);
    doc.text(`Supabase Client ID: ${data.storage_proof.client_id || 'N/A'}`); // Assuming client_id might be stored here
    doc.text(`Tables: ${safeFormat(data.storage_proof.tables.join(', '))}`);
    doc.moveDown(1);

    doc.end();

    stream.on('finish', () => {
        console.log(`PDF generated successfully: ${filePath}`);
    });
    stream.on('error', (err) => {
        console.error('Error writing PDF:', err);
    });
}

async function main() {
    console.log('Starting PDF generation for Anthony Pettitt...');

    if (clientData['Anthony Pettitt']) {
        clientData['Anthony Pettitt'].county_assessed = clientData['Anthony Pettitt'].county_assessed || {};
        clientData['Anthony Pettitt'].assessed_source = clientData['Anthony Pettitt'].assessed_source || 'N/A';
        clientData['Anthony Pettitt'].assessed_url = clientData['Anthony Pettitt'].assessed_url || null;
        clientData['Anthony Pettitt'].status = 'READY FOR REVIEW'; // Based on analysis
        clientData['Anthony Pettitt'].recommendation_reason = 'The CAD market value of $909,091 is higher than the indicated value of $844,838 based on 15 comparable sales. The median adjusted comparable sale price supports the indicated value. The property appears to be over-assessed by approximately 7.07%.';
        clientData['Anthony Pettitt'].over_assessment = clientData['Anthony Pettitt'].assessed_value - clientData['Anthony Pettitt'].proposed_value;
        clientData['Anthony Pettitt'].storage_proof.client_id = 'TEMP_CLIENT_ID_ANTHONY_PETTITT'; // Placeholder
        await createPDF('Anthony Pettitt', clientData['Anthony Pettitt']);
    } else {
        console.log('Skipping Anthony Pettitt: data not found.');
    }

    console.log('\nPDF generation complete. Check /tmp folder for files.');
}

main().catch(err => {
    console.error('PDF Generation Failed:', err);
});
