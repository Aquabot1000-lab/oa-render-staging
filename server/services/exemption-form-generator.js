/**
 * Exemption Form Generator — generates pre-filled TX Form 50-114
 * (Application for Residential Homestead Exemption) as PDF
 */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const OUTPUT_DIR = path.join(__dirname, '..', 'uploads', 'exemptions');

async function generateExemptionForm(exemption) {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    const client = exemption.clients || {};
    const property = exemption.properties || {};
    const exType = exemption.exemption_type || '';
    const notes = typeof exemption.notes === 'string' ? JSON.parse(exemption.notes || '{}') : (exemption.notes || {});
    
    // Determine which checkboxes to check
    const isHomestead = /homestead/i.test(exType);
    const isOver65 = /over.?65|senior/i.test(exType);
    const isDisability = /disab/i.test(exType);
    const isVeteran = /vet/i.test(exType);

    // Parse address into components
    const addrParts = parseAddress(property.address || '');

    // Read HTML template
    const templatePath = path.join(TEMPLATES_DIR, 'tx-50-114.html');
    let html = await fs.readFile(templatePath, 'utf8');

    // Replace template variables
    const replacements = {
        '{{OWNER_NAME}}': client.name || '',
        '{{PROPERTY_ADDRESS}}': addrParts.street || property.address || '',
        '{{CITY}}': addrParts.city || '',
        '{{STATE}}': addrParts.state || property.state || 'TX',
        '{{ZIP}}': addrParts.zip || '',
        '{{COUNTY}}': addrParts.county || '',
        '{{PHONE}}': client.phone || '',
        '{{EMAIL}}': client.email || '',
        '{{DOB}}': '', // Client needs to fill in
        '{{DL_NUMBER}}': '', // Client needs to fill in
        '{{DATE_ACQUIRED}}': notes.yearPurchased || '',
        '{{DATE_OCCUPIED}}': notes.yearPurchased || '',
        '{{PERCENT_HOMESTEAD}}': '100',
        '{{TODAYS_DATE}}': new Date().toLocaleDateString('en-US'),
        '{{CHECK_GENERAL_HOMESTEAD}}': isHomestead ? 'checked' : '',
        '{{CHECK_OVER_65}}': isOver65 ? 'checked' : '',
        '{{CHECK_DISABILITY}}': isDisability ? 'checked' : '',
        '{{CHECK_VETERAN}}': isVeteran ? 'checked' : '',
        '{{HIGHLIGHT_DOB}}': '#fff3cd',
        '{{HIGHLIGHT_DL}}': '#fff3cd',
        '{{HIGHLIGHT_SIG}}': '#fff3cd'
    };

    for (const [key, value] of Object.entries(replacements)) {
        html = html.replaceAll(key, value);
    }

    // Generate PDF with puppeteer
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const filename = `TX-50-114-${exemption.id}-${Date.now()}.pdf`;
    const outputPath = path.join(OUTPUT_DIR, filename);
    
    await page.pdf({
        path: outputPath,
        format: 'Letter',
        printBackground: true,
        margin: { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' }
    });

    await browser.close();
    
    return `/uploads/exemptions/${filename}`;
}

function parseAddress(address) {
    // Simple address parser: "123 Main St, San Antonio, TX 78201"
    const parts = address.split(',').map(s => s.trim());
    const result = { street: '', city: '', state: '', zip: '', county: '' };
    
    if (parts.length >= 1) result.street = parts[0];
    if (parts.length >= 2) result.city = parts[1];
    if (parts.length >= 3) {
        const stateZip = parts[2].trim().split(/\s+/);
        if (stateZip.length >= 1) result.state = stateZip[0];
        if (stateZip.length >= 2) result.zip = stateZip[1];
    }
    
    // County lookup for common TX cities
    const countyMap = {
        'san antonio': 'Bexar',
        'houston': 'Harris',
        'austin': 'Travis',
        'dallas': 'Dallas',
        'fort worth': 'Tarrant',
        'plano': 'Collin',
        'arlington': 'Tarrant',
        'el paso': 'El Paso'
    };
    const cityLower = result.city.toLowerCase();
    result.county = countyMap[cityLower] || '';

    return result;
}

module.exports = { generateExemptionForm };
