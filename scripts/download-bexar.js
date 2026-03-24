#!/usr/bin/env node
/**
 * Download Bexar County parcel data from ArcGIS MapServer
 * Source: https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0
 * ~710K parcels, 1000 per page
 */

const https = require('https');
const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://maps.bexar.org/arcgis/rest/services/Parcels/MapServer/0/query';
const PAGE_SIZE = 1000;
const OUTPUT_DIR = path.join(__dirname, '..', 'server', 'data', 'bexar');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'parcels-compact.jsonl.gz');
const FIELDS = 'PropID,Situs,Owner,TotVal,LandVal,ImprVal,YrBlt,GBA,TOT_GBA,LglDesc,Nbhd,Exempts,State_cd,PropUse,AcctNumb,LglAcres';
const CONCURRENT = 5;

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
        const url = `${BASE_URL}?${params}`;
        
        https.get(url, { timeout: 30000 }, (res) => {
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
    return {
        propertyId: a.PropID ? String(Math.round(a.PropID)) : null,
        accountNumber: a.AcctNumb || null,
        address: a.Situs || null,
        ownerName: a.Owner || null,
        appraisedValue: a.TotVal || 0,
        landValue: a.LandVal || 0,
        improvementValue: a.ImprVal || 0,
        yearBuilt: a.YrBlt || null,
        sqft: parseInt(a.GBA || a.TOT_GBA || '0') || null,
        legalDescription: a.LglDesc || null,
        neighborhoodCode: a.Nbhd || null,
        exemptions: a.Exempts || null,
        propertyType: a.State_cd || a.PropUse || 'R',
        acres: a.LglAcres || null
    };
}

async function downloadAll() {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    
    // First get total count
    const countData = await fetchPage(0);
    console.log(`Starting download... (page size: ${PAGE_SIZE})`);
    
    const gzStream = zlib.createGzip({ level: 6 });
    const fileStream = fs.createWriteStream(OUTPUT_FILE);
    gzStream.pipe(fileStream);
    
    let totalRecords = 0;
    let offset = 0;
    const startTime = Date.now();
    let done = false;
    
    while (!done) {
        // Fetch CONCURRENT pages in parallel
        const offsets = [];
        for (let i = 0; i < CONCURRENT && !done; i++) {
            offsets.push(offset);
            offset += PAGE_SIZE;
        }
        
        try {
            const batches = await Promise.all(offsets.map(o => fetchPage(o).catch(err => {
                console.error(`Error at offset ${o}: ${err.message}, retrying...`);
                return new Promise(r => setTimeout(r, 3000)).then(() => fetchPage(o));
            })));
            
            for (const features of batches) {
                if (!features || features.length === 0) {
                    done = true;
                    break;
                }
                for (const f of features) {
                    const record = transformRecord(f);
                    if (record.address || record.appraisedValue > 0) {
                        gzStream.write(JSON.stringify(record) + '\n');
                        totalRecords++;
                    }
                }
                if (features.length < PAGE_SIZE) {
                    done = true;
                }
            }
        } catch (err) {
            console.error(`Batch error at offset ${offsets[0]}: ${err.message}`);
            // Retry individual pages
            for (const o of offsets) {
                try {
                    await new Promise(r => setTimeout(r, 2000));
                    const features = await fetchPage(o);
                    if (!features || features.length === 0) { done = true; break; }
                    for (const f of features) {
                        const record = transformRecord(f);
                        if (record.address || record.appraisedValue > 0) {
                            gzStream.write(JSON.stringify(record) + '\n');
                            totalRecords++;
                        }
                    }
                    if (features.length < PAGE_SIZE) { done = true; break; }
                } catch (e2) {
                    console.error(`Failed offset ${o} after retry: ${e2.message}`);
                }
            }
        }
        
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = (totalRecords / (elapsed || 1)).toFixed(0);
        process.stdout.write(`\r  ${totalRecords.toLocaleString()} records | ${elapsed}s | ${rate}/s | offset ${offset.toLocaleString()}`);
    }
    
    // Finalize
    await new Promise((resolve, reject) => {
        gzStream.end(() => {
            fileStream.on('finish', resolve);
            fileStream.on('error', reject);
        });
    });
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const fileSize = (fs.statSync(OUTPUT_FILE).size / 1024 / 1024).toFixed(1);
    console.log(`\n✅ Bexar County: ${totalRecords.toLocaleString()} parcels in ${elapsed}s (${fileSize}MB compressed)`);
}

downloadAll().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
