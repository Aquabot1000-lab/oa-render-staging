#!/usr/bin/env node
/**
 * Generic ArcGIS County Parcel Downloader
 * Usage: node download-county.js <county> <baseUrl> <fields> [pageSize]
 */
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length < 3) {
    console.log('Usage: node download-county.js <county> <queryUrl> <fields> [pageSize]');
    console.log('Example: node download-county.js williamson "https://gis.wilco.org/arcgis/rest/services/public/county_wcad_parcels/MapServer/0/query" "TotalAssessedValue,SitusAddress,PrimaryOwner"');
    process.exit(1);
}

const COUNTY = args[0];
const QUERY_URL = args[1];
const FIELDS = args[2];
const PAGE_SIZE = parseInt(args[3] || '1000');
const OUTPUT_DIR = path.join(__dirname, '..', 'server', 'data', COUNTY);
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'parcels-compact.jsonl.gz');

function fetchPage(offset) {
    return new Promise((resolve, reject) => {
        const params = new URLSearchParams({
            where: '1=1',
            outFields: FIELDS,
            returnGeometry: 'false',
            resultOffset: offset.toString(),
            resultRecordCount: PAGE_SIZE.toString(),
            orderByFields: 'OBJECTID ASC',
            f: 'json'
        });
        const url = `${QUERY_URL}?${params}`;
        const client = url.startsWith('https') ? https : http;
        
        client.get(url, { timeout: 30000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json.features || []);
                } catch (e) {
                    reject(new Error(`Parse error at offset ${offset}: ${e.message}`));
                }
            });
            res.on('error', reject);
        }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error(`Timeout at offset ${offset}`)); });
    });
}

function transformRecord(feature) {
    const a = feature.attributes || {};
    // Normalize field names (different counties use different names)
    return {
        propertyId: a.PropID || a.PropertyNumber || a.PARCELID || a.AccountNumber || a.AcctNumb || a.accountId || null,
        accountNumber: a.AcctNumb || a.AccountNumber || a.PropertyNumber || null,
        address: a.Situs || a.SitusAddress || a.PropertyAddress || a.SITEADDRESS || a.situs_address || a.Address || null,
        ownerName: a.Owner || a.PrimaryOwner || a.FullName || a.OwnerName || a.owner_name || null,
        appraisedValue: a.TotVal || a.TotalAssessedValue || a.TotalPropMktValue || a.appraisedValue || a.AssessedValue || a.MarketValue || 0,
        landValue: a.LandVal || a.TotalLandMktValue || a.LNDVALUE || a.landValue || 0,
        improvementValue: a.ImprVal || a.TotalImpMktValue || a.improvementValue || 0,
        yearBuilt: a.YrBlt || a.YearBuilt || a.year_built || null,
        sqft: parseInt(a.GBA || a.TOT_GBA || a.TotalSqFtLivingArea || a.RESFLRAREA || a.sqft || '0') || null,
        legalDescription: a.LglDesc || a.LegalLocationDesc || a.legal_description || null,
        neighborhoodCode: a.Nbhd || a.NeighborhoodCode || a.neighborhood || null,
        exemptions: a.Exempts || a.ExemptionList || a.exemptions || null,
        propertyType: a.State_cd || a.PropUse || a.PropertyType || a.property_type || 'R',
        acres: a.LglAcres || a.Acres || a.STATEDAREA || a.AssessedAc || null
    };
}

async function downloadAll() {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`[${COUNTY}] Starting download (page size: ${PAGE_SIZE})...`);
    
    const gzStream = zlib.createGzip({ level: 6 });
    const fileStream = fs.createWriteStream(OUTPUT_FILE);
    gzStream.pipe(fileStream);
    
    let totalRecords = 0;
    let offset = 0;
    const startTime = Date.now();
    let done = false;
    const CONCURRENT = 5;
    
    while (!done) {
        const offsets = [];
        for (let i = 0; i < CONCURRENT && !done; i++) {
            offsets.push(offset);
            offset += PAGE_SIZE;
        }
        
        try {
            const batches = await Promise.all(offsets.map(o => fetchPage(o).catch(err => {
                console.error(`\n  Error at offset ${o}: ${err.message}, retrying...`);
                return new Promise(r => setTimeout(r, 3000)).then(() => fetchPage(o));
            })));
            
            for (const features of batches) {
                if (!features || features.length === 0) { done = true; break; }
                for (const f of features) {
                    const record = transformRecord(f);
                    if (record.address || record.appraisedValue > 0) {
                        gzStream.write(JSON.stringify(record) + '\n');
                        totalRecords++;
                    }
                }
                if (features.length < PAGE_SIZE) { done = true; }
            }
        } catch (err) {
            console.error(`\n  Batch error: ${err.message}`);
            done = true;
        }
        
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        process.stdout.write(`\r  ${totalRecords.toLocaleString()} records | ${elapsed}s | offset ${offset.toLocaleString()}`);
    }
    
    await new Promise((resolve, reject) => {
        gzStream.end(() => { fileStream.on('finish', resolve); fileStream.on('error', reject); });
    });
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const fileSize = (fs.statSync(OUTPUT_FILE).size / 1024 / 1024).toFixed(1);
    console.log(`\n✅ ${COUNTY}: ${totalRecords.toLocaleString()} parcels in ${elapsed}s (${fileSize}MB)`);
}

downloadAll().catch(err => { console.error('Fatal:', err); process.exit(1); });
