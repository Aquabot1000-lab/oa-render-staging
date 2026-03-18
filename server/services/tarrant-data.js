/**
 * Tarrant County Appraisal District (TAD) Real Property Data
 * 
 * Loads 729K+ real parcel records from Tarrant CAD into memory for:
 *   - O(1) account number lookups
 *   - Fast comparable property searches
 *   - Real parcel IDs (Account_Nu) for evidence packets
 * 
 * Data source: TAD ParcelView export (converted to JSONL)
 * Fields: account, address, property class, values, sqft, year built, etc.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Data file paths — check env first, then default locations
const DATA_PATHS = [
    process.env.TAD_DATA_PATH,
    path.join(__dirname, '..', '..', 'data', 'tarrant', 'parcels-compact.jsonl'),
    path.join(__dirname, '..', 'data', 'tarrant', 'parcels-compact.jsonl'),
    '/Users/aquabot/Documents/OverAssessed/data/tarrant/parcels-compact.jsonl'
].filter(Boolean);

// In-memory indexes
let accountIndex = null;       // Map<accountNum, record>
let propertyClassIndex = null; // Map<classCode, record[]>
let loaded = false;
let loading = false;
let loadError = null;
let recordCount = 0;

/**
 * Property class descriptions for Tarrant CAD
 */
const PROPERTY_CLASSES = {
    'A1': 'Single Family Residence',
    'A2': 'Multi-Family (2-4 units)',
    'B1': 'Multi-Family (5+ units)',
    'B2': 'Duplex',
    'C1': 'Vacant Residential Lot',
    'D1': 'Qualified Agricultural',
    'E1': 'Rural Improved',
    'F1': 'Commercial Real',
    'F2': 'Industrial Real',
    'J1': 'Utility',
    'L1': 'Commercial Personal',
    'L2': 'Industrial Personal',
    'M1': 'Mobile Home',
    'O1': 'Residential Inventory',
    'X1': 'Exempt'
};

/**
 * Expand compact record to full field names
 */
function expandRecord(r) {
    return {
        accountNumber: r.a,
        address: r.s,
        propertyClass: r.c,
        totalValue: r.tv,
        appraisedValue: r.av,
        landValue: r.lv,
        improvementValue: r.iv,
        sqft: r.sf,
        yearBuilt: r.yb,
        bedrooms: r.bd,
        bathrooms: r.ba,
        hasPool: r.pl === 1,
        garageCap: r.gc,
        legalDescription: r.ld,
        zipCode: r.z,
        propertyClassDesc: PROPERTY_CLASSES[r.c] || r.c
    };
}

/**
 * Load data from JSONL file into memory indexes.
 * Call once at server startup.
 */
async function loadData() {
    if (loaded || loading) return loaded;
    loading = true;

    // Find the data file
    let dataPath = null;
    for (const p of DATA_PATHS) {
        try {
            await fs.promises.access(p, fs.constants.R_OK);
            dataPath = p;
            break;
        } catch { /* try next */ }
    }

    if (!dataPath) {
        loadError = 'TAD data file not found. Checked: ' + DATA_PATHS.join(', ');
        console.warn(`[TarrantData] ⚠️ ${loadError}`);
        console.warn('[TarrantData] Real comps will not be available. Falling back to synthetic.');
        loading = false;
        return false;
    }

    console.log(`[TarrantData] Loading Tarrant CAD data from ${dataPath}...`);
    const startTime = Date.now();

    accountIndex = new Map();
    propertyClassIndex = new Map();

    return new Promise((resolve) => {
        const stream = fs.createReadStream(dataPath, { encoding: 'utf-8' });
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        let count = 0;

        rl.on('line', (line) => {
            if (!line.trim()) return;
            try {
                const rec = JSON.parse(line);

                // Index by account number
                if (rec.a) {
                    accountIndex.set(rec.a, rec);
                }

                // Index by property class
                if (rec.c) {
                    if (!propertyClassIndex.has(rec.c)) {
                        propertyClassIndex.set(rec.c, []);
                    }
                    propertyClassIndex.get(rec.c).push(rec);
                }

                count++;
            } catch (e) {
                // Skip malformed lines
            }
        });

        rl.on('close', () => {
            recordCount = count;
            loaded = true;
            loading = false;
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const memMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0);
            console.log(`[TarrantData] ✅ Loaded ${count.toLocaleString()} parcels in ${elapsed}s (heap: ${memMB}MB)`);
            console.log(`[TarrantData] Property classes: ${[...propertyClassIndex.keys()].sort().join(', ')}`);
            resolve(true);
        });

        rl.on('error', (err) => {
            loadError = err.message;
            loading = false;
            console.error(`[TarrantData] ❌ Load failed: ${err.message}`);
            resolve(false);
        });
    });
}

/**
 * Check if TAD data is loaded and available
 */
function isLoaded() {
    return loaded && accountIndex !== null;
}

/**
 * Lookup a property by TAD account number.
 * @param {string} accountNum - 8-character TAD account number
 * @returns {Object|null} Expanded property record or null
 */
function lookupAccount(accountNum) {
    if (!isLoaded() || !accountNum) return null;
    const rec = accountIndex.get(accountNum.trim());
    return rec ? expandRecord(rec) : null;
}

/**
 * Extract neighborhood/subdivision from legal description.
 * TAD legal descriptions often start with the subdivision name.
 */
function extractNeighborhood(legalDesc) {
    if (!legalDesc) return null;
    // Common patterns: 
    // "TANGLEWOOD ADDITION-FORT WORTH Block 1 Lot 5" → "TANGLEWOOD ADDITION"
    // "WESTCLIFF ADD BLK 5 LOT 12" → "WESTCLIFF ADD"
    // "MIRA VISTA ADD BLK 1 LOT 3" → "MIRA VISTA ADD"
    // "OVERTON PARK SOUTH Block 2 Lot 15" → "OVERTON PARK SOUTH"
    
    // Try pattern with hyphen-city first (e.g., "TANGLEWOOD ADDITION-FORT WORTH")
    // INCLUDE the city to distinguish same-named subdivisions in different cities
    let match = legalDesc.match(/^([A-Z][A-Z\s]+?(?:ADDITION|ADD|ADDN)?[\s-]+(?:FORT WORTH|ARLINGTON|MANSFIELD|HURST|BEDFORD|EULESS|KELLER|SOUTHLAKE|COLLEYVILLE|GRAPEVINE|NORTH RICHLAND|RICHLAND|HALTOM|WATAUGA|SAGINAW|LAKE WORTH|BENBROOK|CROWLEY|BURLESON|KENNEDALE|FOREST HILL|EVERMAN|SANSOM PARK|RIVER OAKS|WESTWORTH|WHITE SETTLEMENT))/i);
    if (match) return match[1].trim();
    
    // Try standard pattern
    match = legalDesc.match(/^([A-Z][A-Z\s]+?)\s+(?:BLK|BLOCK|LOT|SEC|UNIT|PH|PHASE|TR|TRACT|ADDN?)/i);
    if (match) return match[1].trim();
    
    // Try everything before "Block" or "Lot"
    match = legalDesc.match(/^(.+?)(?:\s+Block\s|\s+Lot\s|\s+BLK\s)/i);
    if (match) return match[1].replace(/[-,]\s*[A-Z][a-z]+.*$/, '').trim();
    
    return null;
}

/**
 * Find comparable properties from real TAD data.
 * 
 * @param {Object} options
 * @param {string} options.address - Subject property address
 * @param {string} options.propertyClass - TAD property class code (e.g., 'A1')
 * @param {number} options.sqft - Subject square footage
 * @param {number} options.yearBuilt - Subject year built
 * @param {string} [options.legalDescription] - Subject legal description (for neighborhood matching)
 * @param {string} [options.zipCode] - Subject zip code
 * @param {number} [options.maxResults=20] - Maximum comps to return
 * @param {number} [options.sqftRange=0.30] - Sqft tolerance (±30%)
 * @param {number} [options.yearRange=15] - Year built tolerance (±15 years)
 * @returns {Object[]} Array of comparable property records, sorted by value (lowest first)
 */
function findComps(options) {
    if (!isLoaded()) {
        console.warn('[TarrantData] Data not loaded, cannot find comps');
        return [];
    }

    const {
        address,
        propertyClass,
        sqft,
        yearBuilt,
        legalDescription,
        zipCode,
        maxResults = 20,
        sqftRange = 0.30,
        yearRange = 15
    } = options;

    // Get candidates by property class
    const pClass = propertyClass || 'A1';
    const candidates = propertyClassIndex.get(pClass);
    if (!candidates || candidates.length === 0) {
        console.log(`[TarrantData] No properties found for class ${pClass}`);
        return [];
    }

    console.log(`[TarrantData] Searching ${candidates.length.toLocaleString()} ${pClass} properties...`);

    // Normalize subject address for dedup
    const normalizedSubjectAddr = (address || '').toUpperCase().replace(/[^A-Z0-9\s]/g, '').trim();
    const subjectNeighborhood = extractNeighborhood(legalDescription);
    const subjectZip = (zipCode || '').substring(0, 5);

    // Filter and score
    const minSqft = sqft ? Math.round(sqft * (1 - sqftRange)) : 0;
    const maxSqft = sqft ? Math.round(sqft * (1 + sqftRange)) : Infinity;
    const minYear = yearBuilt ? yearBuilt - yearRange : 0;
    const maxYear = yearBuilt ? yearBuilt + yearRange : 9999;

    const matches = [];

    for (const rec of candidates) {
        // Skip the subject property itself
        const recAddr = (rec.s || '').toUpperCase().replace(/[^A-Z0-9\s]/g, '').trim();
        if (recAddr === normalizedSubjectAddr) continue;

        // Must have a reasonable total value (skip demolished/damaged/vacant parcels)
        if (!rec.tv || rec.tv < 20000) continue;

        // Skip properties with suspiciously low $/sqft (likely capped, frozen, or data errors)
        // Typical Tarrant County range is $80-250/sf; anything below $50/sf is almost certainly
        // a capped homestead, partial assessment, or data anomaly
        if (rec.sf && rec.sf > 0 && rec.tv / rec.sf < 50) continue;

        // Must have sqft > 0 if we're filtering by sqft
        if (sqft && (!rec.sf || rec.sf <= 0)) continue;

        // Sqft range filter
        if (sqft && (rec.sf < minSqft || rec.sf > maxSqft)) continue;

        // Year built range filter
        if (yearBuilt && rec.yb && (rec.yb < minYear || rec.yb > maxYear)) continue;

        // Score this comp (higher = better match)
        let score = 50; // base

        // Neighborhood match (from legal description)
        const compNeighborhood = extractNeighborhood(rec.ld);
        if (subjectNeighborhood && compNeighborhood && subjectNeighborhood === compNeighborhood) {
            score += 25; // Strong neighborhood match
        }

        // Zip code match
        if (subjectZip && rec.z && rec.z.substring(0, 5) === subjectZip) {
            score += 10;
        }

        // Sqft similarity
        if (sqft && rec.sf) {
            const sqftDiff = Math.abs(rec.sf - sqft) / sqft;
            if (sqftDiff <= 0.10) score += 15;
            else if (sqftDiff <= 0.20) score += 8;
        }

        // Year built similarity
        if (yearBuilt && rec.yb) {
            const yearDiff = Math.abs(rec.yb - yearBuilt);
            if (yearDiff <= 5) score += 10;
            else if (yearDiff <= 10) score += 5;
        }

        matches.push({
            rec,
            score,
            sameNeighborhood: subjectNeighborhood && compNeighborhood && subjectNeighborhood === compNeighborhood
        });
    }

    console.log(`[TarrantData] Found ${matches.length.toLocaleString()} matching properties`);

    // Sort: same neighborhood first, then by total value (lowest first for cherry-picking)
    matches.sort((a, b) => {
        // Prioritize same neighborhood
        if (a.sameNeighborhood && !b.sameNeighborhood) return -1;
        if (!a.sameNeighborhood && b.sameNeighborhood) return 1;
        // Then by value (lowest first — favorable to taxpayer)
        return a.rec.tv - b.rec.tv;
    });

    // Return expanded records
    return matches.slice(0, maxResults).map(m => {
        const expanded = expandRecord(m.rec);
        expanded._score = m.score;
        expanded._sameNeighborhood = m.sameNeighborhood;
        return expanded;
    });
}

/**
 * Find comps optimized for Equal & Uniform analysis.
 * Returns more comps (up to 50) with PSF data for median calculation.
 */
function findEUComps(options) {
    return findComps({
        ...options,
        maxResults: options.maxResults || 50,
        sqftRange: options.sqftRange || 0.35,  // Slightly wider for E&U
        yearRange: options.yearRange || 20
    });
}

/**
 * Search properties by address (partial match).
 * Useful for looking up the subject property.
 */
function searchByAddress(addressQuery, limit = 10) {
    if (!isLoaded()) return [];
    
    const query = (addressQuery || '').toUpperCase().replace(/[^A-Z0-9\s]/g, '').trim();
    if (!query || query.length < 3) return [];

    const results = [];
    for (const [, rec] of accountIndex) {
        const addr = (rec.s || '').toUpperCase();
        if (addr.includes(query)) {
            results.push(expandRecord(rec));
            if (results.length >= limit) break;
        }
    }
    return results;
}

/**
 * Get stats about the loaded data
 */
function getStats() {
    if (!isLoaded()) return { loaded: false, error: loadError };
    
    const classCounts = {};
    for (const [cls, recs] of propertyClassIndex) {
        classCounts[cls] = recs.length;
    }

    return {
        loaded: true,
        totalRecords: recordCount,
        propertyClasses: classCounts,
        memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    };
}

module.exports = {
    loadData,
    isLoaded,
    lookupAccount,
    findComps,
    findEUComps,
    searchByAddress,
    extractNeighborhood,
    getStats,
    PROPERTY_CLASSES
};
