const path = require('path');
process.chdir('/Users/aquabot/Documents/OverAssessed/server');
require('dotenv').config();

const { generateTaxNetPackage } = require('./services/taxnet-package-generator');

(async () => {
    // Case data from DB
    const caseData = {
        case_id: 'OA-0027',
        owner_name: 'Juan Villarreal',
        email: 'juanvillarreal@outlook.com',
        phone: '(210) 596-6699',
        property_address: '24209 Scenic Loop Rd, San Antonio, TX 78255',
        county: 'Bexar',
        assessed_value: 812660
    };

    // Property details from notice
    const property = {
        sqft: 1800,
        yearBuilt: 1979, // estimated from comps in same nbhd/vintage
        acres: 9.9,
        accountId: '250941',
        geoId: '04703-010-0020',
        assessedValue: 812660,
        improvementValue: 305710,
        landValue: 506950,
        address: '24209 Scenic Loop Rd, San Antonio, TX 78255',
        legalDescription: 'CB 4703A BLK LOT W 80 FT OF LOTS 2-3 & E IRRG 307.4 OF LOT 4',
        notes: 'old and outdated per owner — LLC-owned investment property',
        opinionOfValue: 570000 // based on median of comps
    };

    // 10 best comps from BCAD ArcGIS — Scenic Loop Rd corridor
    // Criteria: ±20% sqft (1440-2160), older homes, acreage prioritized, lower-valued first
    const comps = [
        { address: '17400 SCENIC LOOP RD', propId: '04558-000-0300', marketValue: 320590, improvValue: 176690, sqft: 1800, yearBuilt: 1979, acres: 1.484, nbhd: '25200', owner: 'MONTALVO GREGORY' },
        { address: '19936 SCENIC LOOP RD', propId: '04606-000-0103', marketValue: 321730, improvValue: 157640, sqft: 1800, yearBuilt: 1995, acres: 1.22, nbhd: '21031', owner: 'PRADO STEPHAN' },
        { address: '17400 SCENIC LOOP RD', propId: '04558-000-0190', marketValue: 318450, improvValue: 199050, sqft: 1949, yearBuilt: 1983, acres: 1.137, nbhd: '25200', owner: 'GARZA DOLORES' },
        { address: '16059 SCENIC LOOP RD', propId: '04554-007-0250', marketValue: 373580, improvValue: 198500, sqft: 1808, yearBuilt: 1962, acres: 2.08, nbhd: '25200', owner: 'LUKE JO ANN' },
        { address: '21250 SCENIC LOOP RD', propId: '05578-000-0015', marketValue: 478190, improvValue: 320000, sqft: 1877, yearBuilt: 2001, acres: 2.44, nbhd: '21031', owner: 'GOTTSCHALK BERNARD' },
        { address: '19007 SCENIC LOOP RD', propId: '05744-019-0040', marketValue: 500000, improvValue: 177780, sqft: 1786, yearBuilt: 1936, acres: 5.07, nbhd: '25380', owner: 'STANDARD HARMONY' },
        { address: '21845 SCENIC LOOP RD', propId: '04613-000-0030', marketValue: 570000, improvValue: 274590, sqft: 1992, yearBuilt: 1986, acres: 3.39, nbhd: '21031', owner: 'FLECK MICHAEL' },
        { address: '21250 SCENIC LOOP RD', propId: '04610-000-0025', marketValue: 578570, improvValue: 274130, sqft: 1732, yearBuilt: 1998, acres: 4.56, nbhd: '21031', owner: 'GOTTSCHALK LINDA' },
        { address: '21010 SCENIC LOOP RD', propId: '04610-000-0060', marketValue: 603520, improvValue: 223140, sqft: 1656, yearBuilt: 1968, acres: 8.3216, nbhd: '21031', owner: 'CIOMPERLIK ELIZABETH' },
        { address: '18211 SCENIC LOOP RD', propId: '05744-019-0311', marketValue: 617000, improvValue: 398900, sqft: 1812, yearBuilt: 1993, acres: 2.91, nbhd: '25380', owner: 'WHEELER CHARLES' }
    ].sort((a, b) => a.marketValue - b.marketValue);

    console.log('Generating TaxNet package for OA-0027...');
    console.log('Comps:', comps.length);
    console.log('Avg value: $' + Math.round(comps.reduce((s,c) => s + c.marketValue, 0) / comps.length).toLocaleString());
    
    try {
        const result = await generateTaxNetPackage(caseData, property, comps);
        console.log('\n✅ PACKAGE GENERATED');
        console.log('File:', result.filePath);
        console.log('Comps used:', result.compsUsed);
        console.log('Format:', result.format);
    } catch (e) {
        console.error('❌ FAILED:', e.message);
    }
})();
