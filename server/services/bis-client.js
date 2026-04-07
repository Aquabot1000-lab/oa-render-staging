/**
 * BIS (Business Information Systems) Client
 * 
 * Real-data client for Texas County Appraisal Districts using BIS e-search portals.
 * Supports: Kaufman, Collin, Fort Bend, Travis, Williamson, Hunt, and other BIS-powered CADs.
 * 
 * NO SYNTHETIC DATA. NO FALLBACKS. REAL PARCEL DATA ONLY.
 * 
 * @version 1.0.0 — 2026-04-07
 */

const axios = require('axios');

class BISClient {
    constructor(baseUrl, countyName) {
        this.baseUrl = baseUrl;
        this.countyName = countyName;
        this.jar = {};
        this.sessionToken = null;
        this.initialized = false;
        this.ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    }

    _addCookies(response) {
        const cookies = response.headers['set-cookie'] || [];
        for (const c of cookies) {
            const [nameVal] = c.split(';');
            const [name, ...valueParts] = nameVal.split('=');
            this.jar[name.trim()] = valueParts.join('=');
        }
    }

    _cookieStr() {
        return Object.entries(this.jar)
            .filter(([k]) => k)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
    }

    /**
     * Initialize session with the BIS portal (required before searches)
     */
    async init() {
        if (this.initialized) return;

        // Visit home page to get session cookie
        const r1 = await axios.get(this.baseUrl, {
            headers: { 'User-Agent': this.ua },
            validateStatus: () => true,
            timeout: 15000
        });
        this._addCookies(r1);

        // Get search session token
        const r2 = await axios.get(`${this.baseUrl}/search/requestSessionToken`, {
            headers: {
                'User-Agent': this.ua,
                Cookie: this._cookieStr(),
                'X-Requested-With': 'XMLHttpRequest'
            },
            validateStatus: () => true,
            timeout: 15000
        });
        this._addCookies(r2);
        this.sessionToken = r2.data?.searchSessionToken || '';
        this.initialized = true;

        console.log(`[BIS:${this.countyName}] Session initialized`);
    }

    /**
     * Reset session state to force re-initialization on next search
     */
    resetSession() {
        this.initialized = false;
        this.jar = {};
        this.sessionToken = null;
    }

    /**
     * Search for properties by keywords.
     * 
     * Keywords format:
     *   - Free text: "2022 Avondown"
     *   - Structured: "StreetNumber:2022 StreetName:Avondown Year:2026"
     *   - Owner: "OwnerName:Matthews Year:2026"
     * 
     * @param {string} keywords - Search keywords
     * @param {number} pageSize - Max results (default 100)
     * @returns {{ results: Array, total: number }}
     */
    async search(keywords, pageSize = 100) {
        await this.init();

        // Step 1: Visit search results page to establish search context
        const searchUrl = `${this.baseUrl}/search/result?keywords=${encodeURIComponent(keywords)}&searchSessionToken=${encodeURIComponent(this.sessionToken)}`;
        const r3 = await axios.get(searchUrl, {
            headers: { 'User-Agent': this.ua, Cookie: this._cookieStr() },
            validateStatus: () => true,
            timeout: 30000
        });
        this._addCookies(r3);

        // Extract anti-forgery search token from page
        const searchTokenMatch = (r3.data || '').match(/name="search-token"\s+content="([^"]+)"/);
        const searchToken = searchTokenMatch ? searchTokenMatch[1] : '';

        // Step 2: POST to SearchResults endpoint (AJAX data endpoint)
        const r4 = await axios({
            method: 'POST',
            url: `${this.baseUrl}/search/SearchResults?keywords=${encodeURIComponent(keywords)}`,
            data: JSON.stringify({
                page: 1,
                pageSize,
                isArb: false,
                recaptchaToken: '',
                searchToken
            }),
            headers: {
                'User-Agent': this.ua,
                Cookie: this._cookieStr(),
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': searchUrl
            },
            validateStatus: () => true,
            timeout: 30000,
            transformResponse: [data => {
                try { return JSON.parse(data); }
                catch (e) { return { error: true, raw: String(data).substring(0, 200) }; }
            }]
        });
        this._addCookies(r4);

        if (r4.data?.error) {
            console.error(`[BIS:${this.countyName}] Search failed: ${r4.data.raw || 'unknown error'}`);
            return { results: [], total: 0 };
        }

        const results = r4.data.resultsList || [];
        const total = r4.data.totalResults || results.length;

        console.log(`[BIS:${this.countyName}] Search "${keywords.substring(0, 50)}" → ${results.length} results (total: ${total})`);

        // Need fresh session for next search (BIS ties session to one search context)
        this.resetSession();

        return { results, total };
    }

    /**
     * Search for a specific property by address.
     * Returns null if not found. Retries up to 3 times (BIS can be flaky).
     * 
     * @param {string} streetNumber
     * @param {string} streetName
     * @param {number} year
     * @returns {Object|null} Property record
     */
    async findProperty(streetNumber, streetName, year = 2026) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            const { results } = await this.search(
                `StreetNumber:${streetNumber} StreetName:${streetName} Year:${year}`,
                10
            );

            const match = results.find(r =>
                r.streetNumber === parseInt(streetNumber) ||
                (r.address || '').includes(String(streetNumber))
            );

            if (match) return match;

            if (attempt < 3) {
                console.log(`[BIS:${this.countyName}] Retry ${attempt}/3 for ${streetNumber} ${streetName}`);
                await new Promise(r => setTimeout(r, 500 * attempt));
            }
        }
        return null;
    }

    /**
     * Find comparable properties for a subject.
     * Searches same neighborhood and nearby streets.
     * 
     * ALL comps are REAL properties from CAD records.
     * NO synthetic data. NO fallbacks.
     * 
     * @param {Object} subject - Subject property from findProperty
     * @param {Object} options
     * @returns {Array} Array of verified comp records
     */
    async findComps(subject, options = {}) {
        const {
            maxComps = 25,
            valueRange = 0.30,  // ±30% of subject value
            year = 2026
        } = options;

        if (!subject || !subject.appraisedValue) {
            console.error(`[BIS:${this.countyName}] Cannot find comps: no subject or no appraised value`);
            return [];
        }

        const subjectVal = subject.appraisedValue;
        const streetName = subject.streetName || '';
        const neighborhood = subject.neighborhoodCode;
        let allResults = [];
        const seen = new Set();

        // Strategy 1: Search same street
        if (streetName) {
            // BIS is case-sensitive: CAD returns uppercase, but search needs title case
            const rawStreet = subject.streetName || streetName;
            const searchStreet = rawStreet.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
            
            // Retry up to 3 times (BIS can be flaky — first request often returns 0)
            let results = [];
            for (let attempt = 1; attempt <= 3; attempt++) {
                const r = await this.search(`StreetName:${searchStreet} Year:${year}`, 100);
                results = r.results;
                if (results.length > 0) break;
                if (attempt < 3) {
                    console.log(`[BIS:${this.countyName}] Street search retry ${attempt}/3 for ${searchStreet}`);
                    await new Promise(r => setTimeout(r, 500 * attempt));
                }
            }
            for (const r of results) {
                if (!seen.has(r.propertyId)) {
                    seen.add(r.propertyId);
                    allResults.push(r);
                }
            }
        }

        // Strategy 2: Search nearby streets in same subdivision area
        // Extract subdivision name parts for related street searches
        const subdivision = subject.subdivision || '';
        if (subdivision && allResults.length < 50) {
            // Extract base subdivision name (e.g., "DEVONSHIRE" from "S0863 - DEVONSHIRE VILLAGE 3A1 & 3A2")
            const subdivName = subdivision.split(' - ')[1]?.split(/\s+/)[0];
            if (subdivName && subdivName.length > 3) {
                // Title-case the subdivision name (BIS is case-sensitive)
                const tcSubdivName = subdivName.charAt(0).toUpperCase() + subdivName.slice(1).toLowerCase();
                await new Promise(r => setTimeout(r, 300));
                
                // Retry up to 3 times
                let subdivResults = [];
                for (let attempt = 1; attempt <= 3; attempt++) {
                    const r = await this.search(`StreetName:${tcSubdivName} Year:${year}`, 100);
                    subdivResults = r.results;
                    if (subdivResults.length > 0) break;
                    if (attempt < 3) {
                        console.log(`[BIS:${this.countyName}] Subdiv search retry ${attempt}/3 for ${tcSubdivName}`);
                        await new Promise(r => setTimeout(r, 500 * attempt));
                    }
                }
                for (const r of subdivResults) {
                    if (!seen.has(r.propertyId)) {
                        seen.add(r.propertyId);
                        allResults.push(r);
                    }
                }
            }
        }

        // Filter for valid comps
        const comps = allResults.filter(r => {
            // Exclude subject
            if (r.propertyId === subject.propertyId) return false;
            // Must be residential
            if (r.propertyType !== 'R') return false;
            // Must have appraised value
            if (!r.appraisedValue || r.appraisedValue <= 0) return false;
            // Same neighborhood preferred (hard filter if available)
            if (neighborhood && r.neighborhoodCode !== neighborhood) return false;
            // Value range filter
            const ratio = r.appraisedValue / subjectVal;
            return ratio >= (1 - valueRange) && ratio <= (1 + valueRange);
        });

        // Sort by value similarity (closest first)
        comps.sort((a, b) =>
            Math.abs(a.appraisedValue - subjectVal) - Math.abs(b.appraisedValue - subjectVal)
        );

        console.log(`[BIS:${this.countyName}] Found ${comps.length} verified comps for PID ${subject.propertyId}`);

        return comps.slice(0, maxComps);
    }
}

// ─── BIS COUNTY REGISTRY ────────────────────────────────────────
// All BIS-powered Texas CADs that we support

const BIS_COUNTIES = {
    kaufman: {
        baseUrl: 'https://esearch.kaufman-cad.org',
        name: 'Kaufman County'
    },
    collin: {
        baseUrl: 'https://esearch.collincad.org',
        name: 'Collin County'
    },
    'fort bend': {
        baseUrl: 'https://esearch.fbcad.org',
        name: 'Fort Bend County'
    },
    travis: {
        baseUrl: 'https://esearch.traviscad.org',
        name: 'Travis County'
    },
    williamson: {
        baseUrl: 'https://esearch.wcad.org',
        name: 'Williamson County'
    },
    hunt: {
        baseUrl: 'https://esearch.hunt-cad.org',
        name: 'Hunt County'
    },
    denton: {
        baseUrl: 'https://esearch.dentoncad.com',
        name: 'Denton County'
    }
};

/**
 * Get a BIS client for a county.
 * Returns null if county is not BIS-powered.
 */
function getBISClient(countyName) {
    const key = (countyName || '').toLowerCase().replace(/\s*county\s*/i, '').trim();
    const config = BIS_COUNTIES[key];
    if (!config) return null;
    return new BISClient(config.baseUrl, config.name);
}

/**
 * Check if a county is supported by BIS
 */
function isBISCounty(countyName) {
    const key = (countyName || '').toLowerCase().replace(/\s*county\s*/i, '').trim();
    return !!BIS_COUNTIES[key];
}

module.exports = { BISClient, getBISClient, isBISCounty, BIS_COUNTIES };
