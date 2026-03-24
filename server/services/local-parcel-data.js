/**
 * Generic Local Parcel Data Loader
 * 
 * Loads county parcel data from JSONL.gz files into memory for instant lookups.
 * Used for counties where we've downloaded bulk data from ArcGIS/open data portals.
 * 
 * Supports: Bexar, Harris, Travis, Collin, Fort Bend, Williamson, Montgomery, Kaufman, Hunt
 * (Tarrant and Dallas have their own specialized loaders)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');

class LocalParcelData {
    constructor(countyName) {
        this.countyName = countyName;
        this.records = [];        // All records
        this.addressIndex = {};   // Normalized address → record
        this.idIndex = {};        // propertyId → record
        this.loaded = false;
        this.loading = false;
        this.recordCount = 0;
    }

    getDataPath() {
        const base = path.join(__dirname, '..', 'data', this.countyName.toLowerCase());
        const gz = path.join(base, 'parcels-compact.jsonl.gz');
        const plain = path.join(base, 'parcels-compact.jsonl');
        if (fs.existsSync(gz)) return gz;
        if (fs.existsSync(plain)) return plain;
        return null;
    }

    isLoaded() { return this.loaded; }

    async loadData() {
        if (this.loaded || this.loading) return;
        this.loading = true;

        const dataPath = this.getDataPath();
        if (!dataPath) {
            console.log(`[${this.countyName}Data] No data file found, skipping`);
            this.loading = false;
            return;
        }

        const startTime = Date.now();
        console.log(`[${this.countyName}Data] Loading from ${path.basename(dataPath)}...`);

        return new Promise((resolve, reject) => {
            let stream = fs.createReadStream(dataPath);
            if (dataPath.endsWith('.gz')) {
                console.log(`[${this.countyName}Data] Decompressing .gz file...`);
                stream = stream.pipe(zlib.createGunzip());
            }

            const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
            let count = 0;

            rl.on('line', (line) => {
                if (!line.trim()) return;
                try {
                    const record = JSON.parse(line);
                    
                    // Index by property ID
                    if (record.propertyId) {
                        this.idIndex[record.propertyId] = record;
                    }
                    if (record.accountNumber) {
                        this.idIndex[record.accountNumber] = record;
                    }

                    // Index by normalized address for fast lookup
                    if (record.address) {
                        const normalized = this._normalizeAddress(record.address);
                        this.addressIndex[normalized] = record;
                    }

                    count++;
                } catch (e) {
                    // Skip malformed lines
                }
            });

            rl.on('close', () => {
                this.recordCount = count;
                this.loaded = true;
                this.loading = false;
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                const heapMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
                console.log(`[${this.countyName}Data] ✅ Loaded ${count.toLocaleString()} parcels in ${elapsed}s (heap: ${heapMB}MB)`);
                resolve();
            });

            rl.on('error', (err) => {
                this.loading = false;
                console.error(`[${this.countyName}Data] Load error:`, err.message);
                reject(err);
            });
        });
    }

    _normalizeAddress(addr) {
        if (!addr) return '';
        return addr.toUpperCase()
            .replace(/[.,#]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            // Remove city/state/zip suffix for matching
            .replace(/,?\s*(SAN ANTONIO|HOUSTON|DALLAS|AUSTIN|FORT WORTH|PLANO|FRISCO|MCKINNEY|ROUND ROCK|GEORGETOWN|CONROE|SUGAR LAND|KATY|RICHMOND|ROSENBERG|MISSOURI CITY|FORNEY|TERRELL|GREENVILLE|COMMERCE)\s*(TX|TEXAS)?\s*\d*$/i, '')
            .trim();
    }

    searchByAddress(address, limit = 5) {
        if (!this.loaded) return [];
        const needle = this._normalizeAddress(address);
        
        // Exact match first
        if (this.addressIndex[needle]) {
            return [this.addressIndex[needle]];
        }

        // Extract street number and name for fuzzy matching
        const match = needle.match(/^(\d+)\s+(.+)/);
        if (!match) return [];
        const [, streetNum, streetName] = match;
        
        const results = [];
        for (const [key, record] of Object.entries(this.addressIndex)) {
            if (key.startsWith(streetNum + ' ') && key.includes(streetName.split(' ')[0])) {
                results.push(record);
                if (results.length >= limit) break;
            }
        }
        return results;
    }

    lookupById(id) {
        if (!this.loaded) return null;
        return this.idIndex[String(id)] || null;
    }

    /**
     * Find comparable properties for E&U analysis
     */
    findComps(targetRecord, options = {}) {
        if (!this.loaded) return [];
        const { maxComps = 25, maxValueDiff = 0.5, sameType = true } = options;
        
        const targetValue = targetRecord.appraisedValue || targetRecord.totalValue || 0;
        const targetSqft = targetRecord.sqft || 0;
        const targetType = (targetRecord.propertyType || 'R').charAt(0);
        const targetNbhd = targetRecord.neighborhoodCode;
        
        if (!targetValue) return [];
        
        const comps = [];
        const minVal = targetValue * (1 - maxValueDiff);
        const maxVal = targetValue * (1 + maxValueDiff);
        
        for (const [, record] of Object.entries(this.addressIndex)) {
            if (record === targetRecord) continue;
            
            const val = record.appraisedValue || 0;
            if (val < minVal || val > maxVal) continue;
            
            // Same property type
            if (sameType && (record.propertyType || 'R').charAt(0) !== targetType) continue;
            
            // Same neighborhood preferred
            const sameNbhd = targetNbhd && record.neighborhoodCode === targetNbhd;
            
            // Score by similarity
            let score = 0;
            if (sameNbhd) score += 50;
            if (targetSqft && record.sqft) {
                const sqftDiff = Math.abs(record.sqft - targetSqft) / targetSqft;
                score += Math.max(0, 30 - sqftDiff * 100);
            }
            const valDiff = Math.abs(val - targetValue) / targetValue;
            score += Math.max(0, 20 - valDiff * 100);
            
            comps.push({ ...record, _compScore: score });
        }
        
        comps.sort((a, b) => b._compScore - a._compScore);
        return comps.slice(0, maxComps);
    }
}

// Registry of loaded county data
const countyDataRegistry = {};

function getCountyData(countyName) {
    const key = countyName.toLowerCase().replace(/\s+/g, '');
    if (!countyDataRegistry[key]) {
        countyDataRegistry[key] = new LocalParcelData(countyName);
    }
    return countyDataRegistry[key];
}

// Pre-initialize for counties with data files
function initAllCounties() {
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) return;
    
    const counties = fs.readdirSync(dataDir).filter(d => {
        const dir = path.join(dataDir, d);
        return fs.statSync(dir).isDirectory() && 
               d !== 'shared' && d !== 'tx' && d !== 'ga' && d !== 'wa' &&
               d !== 'tarrant' && d !== 'dallas'; // These have their own loaders
    });
    
    const promises = counties.map(async (county) => {
        const loader = getCountyData(county);
        const dataPath = loader.getDataPath();
        if (dataPath) {
            await loader.loadData();
        }
    });
    
    return Promise.all(promises);
}

module.exports = { LocalParcelData, getCountyData, initAllCounties };
