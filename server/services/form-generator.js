const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const FORMS_DIR = path.join(__dirname, '..', 'generated-forms');

// Ensure output directory exists
if (!fs.existsSync(FORMS_DIR)) {
    fs.mkdirSync(FORMS_DIR, { recursive: true });
}

const AGENT_INFO = {
    name: 'OverAssessed AI, LLC',
    address: '6002 Camp Bullis, Suite 208',
    city: 'San Antonio, TX 78257',
    phone: '(210) 760-7236',
    email: 'info@overassessed.ai'
};

const COUNTY_PORTALS = {
    bexar: 'https://bcad.org/online-portal/',
    harris: 'https://owners.hcad.org',
    travis: 'https://traviscad.org/efile/',
    dallas: 'https://www.dallascad.org',
    tarrant: 'https://www.tad.org/login',
    fulton: 'https://fultonassessor.org/property-appeals/'
};

/**
 * Generate a pre-filled Form 50-162 (TX) or POA (GA)
 */
async function generateForm(filing, client, property) {
    const state = (filing.state || 'TX').toUpperCase();
    if (state === 'GA') {
        return generateGAPOA(filing, client, property);
    }
    return generateTXForm50162(filing, client, property);
}

function generateTXForm50162(filing, client, property) {
    return new Promise((resolve, reject) => {
        const filename = `form-50-162-${filing.id}.pdf`;
        const filePath = path.join(FORMS_DIR, filename);
        const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        const ownerName = client.name || 'Property Owner';
        const ownerAddress = client.address || '';
        const ownerCity = [client.city, client.state, client.zip].filter(Boolean).join(', ');
        const propertyAddress = property.address || '';
        const accountNumber = filing.portal_account_id || '';
        const county = (filing.county || '').charAt(0).toUpperCase() + (filing.county || '').slice(1);

        // Header
        doc.fontSize(10).text('Form 50-162', { align: 'right' });
        doc.moveDown(0.5);
        doc.fontSize(16).font('Helvetica-Bold').text('Appointment of Agent for Property Tax Matters', { align: 'center' });
        doc.fontSize(10).font('Helvetica').text('(Tax Code §§1.111, 41.413)', { align: 'center' });
        doc.moveDown(1);

        // Appraisal District
        doc.fontSize(10).font('Helvetica-Bold').text(`Appraisal District: ${county} County Appraisal District`);
        doc.moveDown(0.5);
        doc.font('Helvetica').text(`Tax Year(s): 2025, 2026`);
        doc.moveDown(1);

        // Section 1: Property Owner
        doc.font('Helvetica-Bold').text('SECTION 1: PROPERTY OWNER INFORMATION');
        doc.moveDown(0.3);
        doc.font('Helvetica');
        drawField(doc, 'Property Owner Name:', ownerName);
        drawField(doc, 'Mailing Address:', ownerAddress);
        drawField(doc, 'City, State, ZIP:', ownerCity);
        drawField(doc, 'Phone:', client.phone || '');
        drawField(doc, 'Email:', client.email || '');
        doc.moveDown(0.5);

        // Section 2: Property
        doc.font('Helvetica-Bold').text('SECTION 2: PROPERTY DESCRIPTION');
        doc.moveDown(0.3);
        doc.font('Helvetica');
        drawField(doc, 'Property Address:', propertyAddress);
        drawField(doc, 'Account/Property ID Number:', accountNumber);
        doc.moveDown(0.5);

        // Section 3: Agent
        doc.font('Helvetica-Bold').text('SECTION 3: AGENT INFORMATION');
        doc.moveDown(0.3);
        doc.font('Helvetica');
        drawField(doc, 'Agent Name:', AGENT_INFO.name);
        drawField(doc, 'Address:', `${AGENT_INFO.address}, ${AGENT_INFO.city}`);
        drawField(doc, 'Phone:', AGENT_INFO.phone);
        drawField(doc, 'Email:', AGENT_INFO.email);
        doc.moveDown(0.5);

        // Section 4: Authorization Scope
        doc.font('Helvetica-Bold').text('SECTION 4: SCOPE OF AUTHORIZATION');
        doc.moveDown(0.3);
        doc.font('Helvetica');
        doc.text('The agent named above is authorized to represent the property owner in the following matters:');
        doc.moveDown(0.3);
        drawCheckbox(doc, true, 'Protest appraised or market value before the appraisal review board');
        drawCheckbox(doc, true, 'Attend informal hearings with the appraisal district');
        drawCheckbox(doc, true, 'Receive all notices related to the property tax protest');
        drawCheckbox(doc, true, 'Negotiate and settle on behalf of the property owner');
        drawCheckbox(doc, false, 'Other: ___________________________________');
        doc.moveDown(0.5);

        // Section 5: Expiration
        doc.font('Helvetica-Bold').text('SECTION 5: EXPIRATION');
        doc.moveDown(0.3);
        doc.font('Helvetica');
        doc.text('This appointment expires on: December 31, 2026');
        doc.moveDown(1);

        // Signatures
        doc.font('Helvetica-Bold').text('SECTION 6: SIGNATURES');
        doc.moveDown(0.5);

        const y = doc.y;
        doc.font('Helvetica');
        doc.text('Property Owner Signature:', 50, y);
        doc.moveTo(200, y + 12).lineTo(350, y + 12).stroke();
        doc.fontSize(8).text('Sign here', 255, y + 15, { align: 'left' });
        doc.fontSize(10);
        doc.text('Date: _______________', 370, y);

        doc.moveDown(2);
        const y2 = doc.y;
        doc.text('Print Name:', 50, y2);
        doc.text(ownerName, 200, y2);

        doc.moveDown(2);
        const y3 = doc.y;
        doc.text('Agent Signature:', 50, y3);
        doc.moveTo(200, y3 + 12).lineTo(350, y3 + 12).stroke();
        doc.text('Date: _______________', 370, y3);

        doc.moveDown(2);
        const y4 = doc.y;
        doc.text('Print Name:', 50, y4);
        doc.text(AGENT_INFO.name, 200, y4);

        // Footer
        doc.moveDown(2);
        doc.fontSize(8).fillColor('#666').text(
            'This form is a representation of Texas Comptroller Form 50-162. Generated by OverAssessed AI, LLC.',
            { align: 'center' }
        );

        doc.end();
        stream.on('finish', () => resolve({ filePath, filename, url: `/generated-forms/${filename}` }));
        stream.on('error', reject);
    });
}

function generateGAPOA(filing, client, property) {
    return new Promise((resolve, reject) => {
        const filename = `poa-ga-${filing.id}.pdf`;
        const filePath = path.join(FORMS_DIR, filename);
        const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        const ownerName = client.name || 'Property Owner';
        const propertyAddress = property.address || '';
        const county = (filing.county || 'Fulton').charAt(0).toUpperCase() + (filing.county || 'fulton').slice(1);

        // Header
        doc.fontSize(16).font('Helvetica-Bold').text('POWER OF ATTORNEY', { align: 'center' });
        doc.fontSize(12).text('Letter of Authorization', { align: 'center' });
        doc.fontSize(10).font('Helvetica').text(`${county} County, Georgia`, { align: 'center' });
        doc.moveDown(1.5);

        // Body
        doc.font('Helvetica').fontSize(11);
        doc.text(`I, ${ownerName}, the owner of the property located at:`);
        doc.moveDown(0.5);
        doc.font('Helvetica-Bold').text(`    ${propertyAddress}`, { indent: 20 });
        if (filing.portal_account_id) {
            doc.font('Helvetica').text(`    Account/Parcel ID: ${filing.portal_account_id}`, { indent: 20 });
        }
        doc.moveDown(0.5);
        doc.font('Helvetica').text(
            `do hereby appoint and authorize ${AGENT_INFO.name}, located at ${AGENT_INFO.address}, ${AGENT_INFO.city}, ` +
            `as my agent and representative for the purpose of filing and pursuing an appeal of the assessed value ` +
            `of the above-described property before the ${county} County Board of Equalization and/or Board of Assessors.`
        );
        doc.moveDown(0.5);
        doc.text('This authorization includes, but is not limited to, the power to:');
        doc.moveDown(0.3);

        const powers = [
            'File an appeal of the property assessment on my behalf',
            'Attend and represent me at Board of Equalization hearings',
            'Present evidence and arguments in support of the appeal',
            'Negotiate and accept settlements regarding the assessed value',
            'Receive all correspondence and notices related to this appeal',
            'Sign documents necessary to effectuate the appeal process'
        ];
        powers.forEach(p => {
            doc.text(`  •  ${p}`, { indent: 20 });
        });

        doc.moveDown(0.5);
        doc.text('This Power of Attorney shall remain in effect until December 31, 2026, unless revoked earlier in writing by the property owner.');
        doc.moveDown(1.5);

        // Signatures
        doc.font('Helvetica-Bold').text('PROPERTY OWNER:');
        doc.moveDown(0.5);
        doc.font('Helvetica');

        const y1 = doc.y;
        doc.text('Signature:', 50, y1);
        doc.moveTo(150, y1 + 12).lineTo(350, y1 + 12).stroke();
        doc.fontSize(8).text('Sign here', 230, y1 + 15);
        doc.fontSize(11);
        doc.text('Date: _______________', 370, y1);

        doc.moveDown(1.5);
        doc.text(`Print Name: ${ownerName}`);
        doc.moveDown(1.5);

        doc.font('Helvetica-Bold').text('AUTHORIZED AGENT:');
        doc.moveDown(0.5);
        doc.font('Helvetica');

        const y2 = doc.y;
        doc.text('Signature:', 50, y2);
        doc.moveTo(150, y2 + 12).lineTo(350, y2 + 12).stroke();
        doc.text('Date: _______________', 370, y2);
        doc.moveDown(1.5);
        doc.text(`Print Name: ${AGENT_INFO.name}`);
        doc.text(`${AGENT_INFO.address}, ${AGENT_INFO.city}`);
        doc.text(`Phone: ${AGENT_INFO.phone} | Email: ${AGENT_INFO.email}`);

        // Footer
        doc.moveDown(2);
        doc.fontSize(8).fillColor('#666').text(
            'Generated by OverAssessed AI, LLC. This document serves as a Letter of Authorization for property tax appeal representation in the State of Georgia.',
            { align: 'center' }
        );

        doc.end();
        stream.on('finish', () => resolve({ filePath, filename, url: `/generated-forms/${filename}` }));
        stream.on('error', reject);
    });
}

function drawField(doc, label, value) {
    const y = doc.y;
    doc.font('Helvetica').text(label, 50, y, { continued: false });
    doc.text(value || '___________________________', 200, y);
}

function drawCheckbox(doc, checked, label) {
    const y = doc.y;
    const box = checked ? '☑' : '☐';
    doc.text(`  ${box}  ${label}`, 60, y);
}

module.exports = { generateForm, FORMS_DIR, COUNTY_PORTALS };
