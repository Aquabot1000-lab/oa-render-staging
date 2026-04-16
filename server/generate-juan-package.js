require('dotenv').config();
const { generateTaxNetPackage } = require('./services/taxnet-package-generator');

(async () => {
    const caseData = {
        case_id: 'OA-0027',
        owner_name: 'Juan Villarreal',
        email: 'juanvillarreal@outlook.com',
        phone: '(210) 596-6699',
        property_address: '24209 Scenic Loop Rd, San Antonio, TX 78255',
        county: 'Bexar',
        assessed_value: 812660
    };

    const property = {
        sqft: 1800,
        yearBuilt: 1979,
        effectiveYear: 1979,
        acres: 9.9,
        accountId: '250941',
        geoId: '04703-010-0020',
        assessedValue: 812660,
        improvementValue: 305710,
        landValue: 506950,
        address: '24209 Scenic Loop Rd, San Antonio, TX 78255',
        legalDescription: 'CB 4703A BLK LOT W 80 FT OF LOTS 2-3 & E IRRG 307.4 OF LOT 4',
        ownerName: 'Villarreal Brothers Investments LLC',
        conditionScore: 2,
        conditionLabel: 'Fair',
        propClass: 'A1',
        county: 'Bexar',
        opinionOfValue: 570000
    };

    // 10 comps from BCAD ArcGIS — Scenic Loop corridor
    // All ±20% sqft, older homes, acreage prioritized, lower-valued first
    const comps = [
        { address: '17400 SCENIC LOOP RD', propId: '04558-000-0190', marketValue: 318450, improvValue: 199050, landValue: 119400, sqft: 1949, yearBuilt: 1983, acres: 1.137, nbhd: '25200', propClass: 'A1', conditionScore: 3, conditionLabel: 'Average' },
        { address: '17400 SCENIC LOOP RD', propId: '04558-000-0300', marketValue: 320590, improvValue: 176690, landValue: 143900, sqft: 1800, yearBuilt: 1979, acres: 1.484, nbhd: '25200', propClass: 'A1', conditionScore: 3, conditionLabel: 'Average' },
        { address: '19936 SCENIC LOOP RD', propId: '04606-000-0103', marketValue: 321730, improvValue: 157640, landValue: 164090, sqft: 1800, yearBuilt: 1995, acres: 1.22, nbhd: '21031', propClass: 'A1', conditionScore: 3, conditionLabel: 'Average' },
        { address: '16059 SCENIC LOOP RD', propId: '04554-007-0250', marketValue: 373580, improvValue: 198500, landValue: 175080, sqft: 1808, yearBuilt: 1962, acres: 2.08, nbhd: '25200', propClass: 'A1', conditionScore: 3, conditionLabel: 'Average' },
        { address: '21250 SCENIC LOOP RD', propId: '05578-000-0015', marketValue: 478190, improvValue: 320000, landValue: 158190, sqft: 1877, yearBuilt: 2001, acres: 2.44, nbhd: '21031', propClass: 'A1', conditionScore: 3, conditionLabel: 'Average' },
        { address: '19007 SCENIC LOOP RD', propId: '05744-019-0040', marketValue: 500000, improvValue: 177780, landValue: 322220, sqft: 1786, yearBuilt: 1936, acres: 5.07, nbhd: '25380', propClass: 'A1', conditionScore: 3, conditionLabel: 'Average' },
        { address: '21845 SCENIC LOOP RD', propId: '04613-000-0030', marketValue: 570000, improvValue: 274590, landValue: 295410, sqft: 1992, yearBuilt: 1986, acres: 3.39, nbhd: '21031', propClass: 'A1', conditionScore: 3, conditionLabel: 'Average' },
        { address: '21250 SCENIC LOOP RD', propId: '04610-000-0025', marketValue: 578570, improvValue: 274130, landValue: 304440, sqft: 1732, yearBuilt: 1998, acres: 4.56, nbhd: '21031', propClass: 'A1', conditionScore: 3, conditionLabel: 'Average' },
        { address: '21010 SCENIC LOOP RD', propId: '04610-000-0060', marketValue: 603520, improvValue: 223140, landValue: 380380, sqft: 1656, yearBuilt: 1968, acres: 8.32, nbhd: '21031', propClass: 'A1', conditionScore: 3, conditionLabel: 'Average' },
        { address: '18211 SCENIC LOOP RD', propId: '05744-019-0311', marketValue: 617000, improvValue: 398900, landValue: 218100, sqft: 1812, yearBuilt: 1993, acres: 2.91, nbhd: '25380', propClass: 'A1', conditionScore: 3, conditionLabel: 'Average' }
    ];

    console.log('Generating TaxNet E&U package...');
    console.log('Comps:', comps.length);
    
    try {
        const result = await generateTaxNetPackage(caseData, property, comps);
        console.log('✅ PACKAGE GENERATED');
        console.log('File:', result.filePath);
        console.log('Format:', result.format);
        console.log('Comps:', result.compsUsed);
        console.log('Median adjusted:', '$' + result.stats.median.toLocaleString());
        console.log('Range:', '$' + result.stats.min.toLocaleString(), '–', '$' + result.stats.max.toLocaleString());
        console.log('\nAdjustments:');
        for (const a of result.adjustments) {
            console.log('  ' + a.comp + ': adj=$' + a.adjustedValue.toLocaleString() + ' net=' + a.netPct.toFixed(1) + '% gross=' + a.grossPct.toFixed(1) + '%');
        }
    } catch (e) {
        console.error('❌ FAILED:', e.message);
    }
})();
