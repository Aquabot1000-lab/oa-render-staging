#!/usr/bin/env node
/**
 * Downloads county parcel data files from GitHub Releases if not present locally.
 * Run during Railway build/startup to get bulk data without bundling in the deploy.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_FILES = [
    {
        county: 'bexar',
        url: 'https://github.com/Aquabot1000-lab/overassessed-ai/releases/download/data-v1/bexar-parcels.jsonl.gz',
        file: 'parcels-compact.jsonl.gz'
    },
    {
        county: 'dallas', 
        url: 'https://github.com/Aquabot1000-lab/overassessed-ai/releases/download/data-v1/dallas-parcels.jsonl.gz',
        file: 'parcels-compact.jsonl.gz'
    }
];

function download(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const request = (reqUrl) => {
            https.get(reqUrl, { headers: { 'User-Agent': 'OverAssessed-Server' } }, (res) => {
                // Follow redirects (GitHub releases redirect to S3)
                if (res.statusCode === 301 || res.statusCode === 302) {
                    return request(res.headers.location);
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`));
                    return;
                }
                const total = parseInt(res.headers['content-length'] || '0');
                let downloaded = 0;
                res.on('data', (chunk) => {
                    downloaded += chunk.length;
                    if (total > 0) {
                        process.stdout.write(`\r  ${(downloaded / 1024 / 1024).toFixed(1)}MB / ${(total / 1024 / 1024).toFixed(1)}MB`);
                    }
                });
                res.pipe(file);
                file.on('finish', () => {
                    file.close();
                    console.log(` ✅`);
                    resolve();
                });
            }).on('error', reject);
        };
        request(url);
    });
}

async function main() {
    console.log('[DataDownloader] Checking county parcel data files...');
    
    for (const { county, url, file } of DATA_FILES) {
        const dir = path.join(__dirname, '..', 'data', county);
        const dest = path.join(dir, file);
        
        if (fs.existsSync(dest)) {
            const size = (fs.statSync(dest).size / 1024 / 1024).toFixed(1);
            console.log(`[DataDownloader] ${county}: already exists (${size}MB)`);
            continue;
        }
        
        console.log(`[DataDownloader] ${county}: downloading from GitHub Releases...`);
        fs.mkdirSync(dir, { recursive: true });
        
        try {
            await download(url, dest);
            const size = (fs.statSync(dest).size / 1024 / 1024).toFixed(1);
            console.log(`[DataDownloader] ${county}: downloaded ${size}MB`);
        } catch (err) {
            console.error(`[DataDownloader] ${county}: download failed - ${err.message}`);
        }
    }
    
    console.log('[DataDownloader] Done.');
}

// Export for programmatic use
module.exports = { downloadAll: main };

// Also run standalone
if (require.main === module) {
    main().catch(console.error);
}
