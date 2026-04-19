/**
 * Property Data Fetcher — pulls data from Texas county appraisal district websites.
 * Primary: Bexar County (BCAD) via BIS e-search (esearch.bcad.org)
 * Adapter pattern for adding Harris, Travis, etc.
 */

const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { getCountyData, initAllCounties } = require('./local-parcel-data');

// ===== PROPERTY TYPE NORMALIZATION =====
const PROPERTY_TYPE_MAP = {
    // Single Family Home
    'single family': 'Single Family Home', 'sfr': 'Single Family Home', 'single family home': 'Single Family Home',
    'single-family': 'Single Family Home', 'sf': 'Single Family Home', 'detached': 'Single Family Home',
    'single fam': 'Single Family Home', 'res - single': 'Single Family Home',
    // Townhouse / Condo
    'townhouse': 'Townhouse / Condo', 'townhome': 'Townhouse / Condo', 'condo': 'Townhouse / Condo',
    'condominium': 'Townhouse / Condo', 'attached': 'Townhouse / Condo', 'th': 'Townhouse / Condo',
    'patio home': 'Townhouse / Condo', 'zero lot': 'Townhouse / Condo',
    // Duplex / Triplex / Fourplex
    'duplex': 'Duplex / Triplex / Fourplex', 'triplex': 'Duplex / Triplex / Fourplex',
    'fourplex': 'Duplex / Triplex / Fourplex', 'quadplex': 'Duplex / Triplex / Fourplex',
    '2-4 units': 'Duplex / Triplex / Fourplex', 'small multi': 'Duplex / Triplex / Fourplex',
    // Multi-Family (5+ units)
    'apartment': 'Multi-Family (5+ units)', 'multi-family': 'Multi-Family (5+ units)',
    'multi family': 'Multi-Family (5+ units)', 'mf': 'Multi-Family (5+ units)',
    'multifamily': 'Multi-Family (5+ units)', 'apartments': 'Multi-Family (5+ units)',
    'apt': 'Multi-Family (5+ units)', '5+ units': 'Multi-Family (5+ units)',
    // Commercial
    'commercial': 'Commercial', 'industrial': 'Commercial', 'retail': 'Commercial',
    'office': 'Commercial', 'warehouse': 'Commercial', 'mixed use': 'Commercial',
    'com': 'Commercial', 'ind': 'Commercial',
    // Vacant Land
    'land': 'Vacant Land', 'vacant': 'Vacant Land', 'vacant land': 'Vacant Land',
    'lot': 'Vacant Land', 'acreage': 'Vacant Land', 'unimproved': 'Vacant Land',
};

function normalizePropertyType(rawType) {
    if (!rawType) return null;
    const lower = rawType.trim().toLowerCase();
    // Direct match
    if (PROPERTY_TYPE_MAP[lower]) return PROPERTY_TYPE_MAP[lower];
    // Partial match
    for (const [key, value] of Object.entries(PROPERTY_TYPE_MAP)) {
        if (lower.includes(key)) return value;
    }
    // Legacy "Residential" → default to Single Family Home
    if (lower === 'residential' || lower === 'res') return 'Single Family Home';
    return rawType; // Return as-is if no match
}

// ===== COUNTY ADAPTER REGISTRY =====
const countyAdapters = {};

function registerAdapter(county, adapter) {
    countyAdapters[county.toLowerCase()] = adapter;
}

function getAdapter(county) {
    return countyAdapters[(county || 'bexar').toLowerCase()] || null;
}

// ===== BEXAR COUNTY (BCAD) — BIS e-search (esearch.bcad.org) =====
// Migrated from TrueAutomation (dead) to BIS platform 2026-03-23
const bcadAdapter = {
    name: 'Bexar County Appraisal District',
    code: 'BCAD',
    baseUrl: 'https://esearch.bcad.org',

    // ─── BIS SESSION MANAGEMENT ────────────────────────────────────
    // The BIS platform requires: (1) session cookies, (2) a search session token,
    // (3) loading the result page to get a search-token meta tag, then (4) POST for JSON.
    async _createSession() {
        const client = axios.create({
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'X-Requested-With': 'XMLHttpRequest'
            },
            timeout: 60000
        });

        // Get session cookies
        const homeRes = await client.get(this.baseUrl);
        const cookies = (homeRes.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

        // Get search session token (no reCAPTCHA needed)
        const tokenRes = await client.get(this.baseUrl + '/search/requestSessionToken', {
            headers: { Cookie: cookies }
        });
        const searchSessionToken = tokenRes.data.searchSessionToken;

        return { client, cookies, searchSessionToken };
    },

    async _bisSearch(keywords, session) {
        const { client, cookies, searchSessionToken } = session || await this._createSession();

        // Load the result page to establish search context + get search-token meta
        const resultPageUrl = `${this.baseUrl}/search/result?keywords=${encodeURIComponent(keywords)}&searchSessionToken=${encodeURIComponent(searchSessionToken)}`;
        const resultPageRes = await client.get(resultPageUrl, {
            headers: { Cookie: cookies, Accept: 'text/html' }
        });

        const $ = cheerio.load(resultPageRes.data);
        const searchToken = $('meta[name="search-token"]').attr('content');

        // Merge cookies
        const newCookies = (resultPageRes.headers['set-cookie'] || []).map(c => c.split(';')[0]);
        const allCookies = [...new Set([...newCookies, ...cookies.split('; ')])].join('; ');

        // POST for JSON results
        const postData = { page: 1, pageSize: 50, isArb: false, recaptchaToken: '' };
        if (searchToken) postData.searchToken = searchToken;

        const apiUrl = `${this.baseUrl}/search/SearchResults?keywords=${encodeURIComponent(keywords)}`;
        const apiRes = await client.post(apiUrl, postData, {
            headers: {
                Cookie: allCookies,
                'Content-Type': 'application/json',
                Accept: 'application/json, text/javascript, */*; q=0.01',
                Referer: resultPageUrl
            }
        });

        if (apiRes.data && apiRes.data.resultsList) {
            return { data: apiRes.data, client, cookies: allCookies };
        }
        return { data: null, client, cookies: allCookies };
    },

    // ─── IMPROVEMENT DETAILS (sqft, yearBuilt, etc.) ───────────────
    async _getImprovements(propertyId, year, client, cookies) {
        try {
            const url = `${this.baseUrl}/Property/GetImprovements?propertyId=${propertyId}&year=${year}&hideValue=false`;
            const res = await client.get(url, { headers: { Cookie: cookies } });
            if (typeof res.data !== 'string') return {};

            const $ = cheerio.load(res.data);
            let sqft = 0;
            let yearBuilt = null;

            // Parse improvement rows: Type | Description | Class CD | Year Built | SQFT
            $('table tr, tr').each((i, row) => {
                const cells = $(row).find('td');
                if (cells.length < 5) return;
                const type = cells.eq(0).text().trim().toUpperCase();
                const yrText = cells.eq(3).text().trim();
                const sqftText = cells.eq(4).text().trim();
                const yr = parseInt(yrText);
                const sf = parseInt(sqftText.replace(/,/g, ''));

                // LA = Living Area (main sqft), AG = Attached Garage (exclude from living area)
                if (type === 'LA' && sf > 0) sqft += sf;
                if (yr > 1800 && yr < 2100 && (!yearBuilt || yr < yearBuilt)) yearBuilt = yr;
            });

            return { sqft: sqft || null, yearBuilt };
        } catch (err) {
            console.error(`[BCAD] GetImprovements failed for ${propertyId}:`, err.message);
            return {};
        }
    },

    // ─── PUBLIC API ────────────────────────────────────────────────
    async searchByAddress(address) {
        // Try local bulk data first (instant, no network dependency)
        const localData = getCountyData('bexar');
        if (localData.isLoaded()) {
            const localResults = localData.searchByAddress(address);
            if (localResults.length > 0) {
                console.log(`[BCAD] Local data hit: ${localResults.length} results for "${address}"`);
                return localResults.map(r => ({
                    accountId: r.propertyId || r.accountNumber,
                    address: r.address,
                    ownerName: r.ownerName,
                    propertyType: (r.propertyType || 'R') === 'R' ? 'Single Family Home' : r.propertyType,
                    neighborhoodCode: r.neighborhoodCode,
                    assessedValue: r.appraisedValue,
                    landValue: r.landValue,
                    improvementValue: r.improvementValue,
                    legalDescription: r.legalDescription,
                    sqft: r.sqft,
                    yearBuilt: r.yearBuilt,
                    exemptions: r.exemptions,
                    _source: 'local-bulk'
                }));
            }
            console.log(`[BCAD] Local data miss for "${address}", falling back to BIS`);
        }

        // Fallback to BIS web scraper
        try {
            const { streetNumber, streetName } = this._parseAddress(address);
            if (!streetName) return [];

            const currentYear = new Date().getFullYear();
            let keywords = `StreetName:${streetName} Year:${currentYear}`;
            if (streetNumber) keywords = `StreetNumber:${streetNumber} ${keywords}`;

            console.log(`[BCAD] BIS search: ${keywords}`);
            const { data } = await this._bisSearch(keywords);
            if (!data || !data.resultsList) return [];

            console.log(`[BCAD] Found ${data.totalResults} results`);
            return data.resultsList.map(r => ({
                accountId: r.propertyId,
                geoId: r.geoId,
                address: r.address,
                ownerName: r.ownerName,
                propertyType: r.propertyType === 'R' ? 'Single Family Home' : r.propertyType,
                neighborhoodCode: r.neighborhoodCode,
                assessedValue: r.appraisedValue,
                legalDescription: r.legalDescription,
                subdivision: r.subdivision,
                detailUrl: r.detailUrl ? `${this.baseUrl}${r.detailUrl}` : null,
                _bisPropertyId: r.propertyId,
                _bisYear: currentYear
            }));
        } catch (error) {
            console.error('[BCAD] Search failed:', error.message);
            return [];
        }
    },

    async getPropertyDetails(accountIdOrUrl) {
        try {
            // If it's a BIS property ID (numeric), search for it
            const propertyId = typeof accountIdOrUrl === 'string' && accountIdOrUrl.match(/^\d+$/)
                ? accountIdOrUrl
                : (accountIdOrUrl.match(/Id=(\d+)/) || [])[1] || accountIdOrUrl;

            const currentYear = new Date().getFullYear();
            const session = await this._createSession();

            // Search for this specific property
            const keywords = `PropertyId:${propertyId} Year:${currentYear}`;
            const { data, client, cookies } = await this._bisSearch(keywords, session);

            if (!data || !data.resultsList || data.resultsList.length === 0) {
                console.error(`[BCAD] No results for property ID ${propertyId}`);
                return null;
            }

            const r = data.resultsList[0];

            // Get improvement details (sqft, yearBuilt)
            const improvements = await this._getImprovements(r.propertyId, currentYear, client, cookies);

            // Estimate land/improvement split from appraisedValue if not available
            const assessed = r.appraisedValue || 0;

            return {
                source: 'BCAD',
                fetchedAt: new Date().toISOString(),
                accountId: r.propertyId,
                geoId: r.geoId,
                ownerName: r.ownerName,
                address: r.address,
                legalDescription: r.legalDescription,
                propertyType: normalizePropertyType(r.propertyType === 'R' ? 'Single Family Home' : r.propertyType),
                neighborhoodCode: r.neighborhoodCode,
                sqft: improvements.sqft || null,
                yearBuilt: improvements.yearBuilt || null,
                bedrooms: null, // BIS doesn't expose bed/bath in search
                bathrooms: null,
                lotSize: null,
                assessedValue: assessed,
                landValue: null, // Would need separate /Property/GetValues call
                improvementValue: null,
                exemptions: null,
                valueHistory: null
            };
        } catch (error) {
            console.error('[BCAD] Detail fetch failed:', error.message);
            return null;
        }
    },

    async searchComparables(subject, options = {}) {
        try {
            console.log(`[BCAD] Searching BIS for comps near: ${subject.address}`);
            const { streetNumber, streetName } = this._parseAddress(subject.address || '');
            if (!streetName) return [];

            const currentYear = new Date().getFullYear();
            const session = await this._createSession();

            // Strategy 1: Search same street (best neighborhood match)
            const streetKeywords = `StreetName:${streetName} Year:${currentYear}`;
            const { data: streetData, client, cookies } = await this._bisSearch(streetKeywords, session);
            
            let allResults = [];
            if (streetData && streetData.resultsList) {
                allResults = streetData.resultsList.filter(r => 
                    r.propertyType === 'R' && r.appraisedValue > 20000 &&
                    r.propertyId !== (subject.accountId || subject._bisPropertyId)
                );
                console.log(`[BCAD] Street search: ${allResults.length} residential results`);
            }

            // Strategy 2: If not enough comps, search by neighborhood code
            if (allResults.length < 10 && subject.neighborhoodCode) {
                try {
                    const nbhdKeywords = `Neighborhood:${subject.neighborhoodCode} Year:${currentYear}`;
                    const { data: nbhdData } = await this._bisSearch(nbhdKeywords, session);
                    if (nbhdData && nbhdData.resultsList) {
                        const existingIds = new Set(allResults.map(r => r.propertyId));
                        const nbhdResults = nbhdData.resultsList.filter(r =>
                            r.propertyType === 'R' && r.appraisedValue > 20000 &&
                            !existingIds.has(r.propertyId) &&
                            r.propertyId !== (subject.accountId || subject._bisPropertyId)
                        );
                        allResults = allResults.concat(nbhdResults);
                        console.log(`[BCAD] + ${nbhdResults.length} from neighborhood ${subject.neighborhoodCode}`);
                    }
                } catch (err) {
                    console.log(`[BCAD] Neighborhood search failed: ${err.message}`);
                }
            }

            // Get improvement details for each comp (sqft + yearBuilt)
            const details = [];
            const limit = Math.min(allResults.length, options.limit || 30);
            for (let i = 0; i < limit; i++) {
                const r = allResults[i];
                const improvements = await this._getImprovements(r.propertyId, currentYear, client, cookies);
                
                details.push({
                    source: 'BCAD',
                    accountId: r.propertyId,
                    address: r.address,
                    ownerName: r.ownerName,
                    propertyType: normalizePropertyType('Single Family Home'),
                    neighborhoodCode: r.neighborhoodCode,
                    sqft: improvements.sqft || null,
                    yearBuilt: improvements.yearBuilt || null,
                    bedrooms: null,
                    bathrooms: null,
                    lotSize: null,
                    assessedValue: r.appraisedValue,
                    landValue: null,
                    improvementValue: null,
                    legalDescription: r.legalDescription,
                    subdivision: r.subdivision
                });

                // Be polite — 200ms between improvement lookups
                if (i < limit - 1) await new Promise(r => setTimeout(r, 200));
            }

            console.log(`[BCAD] ✅ Returning ${details.length} real comps with improvement data`);
            return details;
        } catch (error) {
            console.error('[BCAD] Comp search failed:', error.message);
            return [];
        }
    },

    // ===== HELPERS =====
    _parseAddress(address) {
        const cleaned = (address || '').replace(/,.*$/, '').trim();
        const parts = cleaned.split(/\s+/);
        let streetNumber = '';
        if (parts.length > 1 && /^\d+$/.test(parts[0])) {
            streetNumber = parts.shift();
        }
        // Keep the full street name including suffix for BIS
        const streetName = parts.join(' ');
        return { streetNumber, streetName };
    }
};

registerAdapter('bexar', bcadAdapter);

// ===== TARRANT COUNTY (Local Data — 729K+ parcels in memory) =====
const tarrantData = require('./tarrant-data');
const tarrantAdapter = {
    name: 'Tarrant CAD (Local Data)',
    async searchByAddress(address) {
        if (!tarrantData.isLoaded()) {
            console.log('[Tarrant] Data not loaded yet, attempting load...');
            await tarrantData.loadData();
        }
        // Normalize address for search — strip city/state/zip, extract street
        const streetMatch = (address || '').match(/^[\d]+\s+[^,]+/);
        const street = streetMatch ? streetMatch[0].toUpperCase().trim() : (address || '').toUpperCase().trim();
        
        // Try exact match first
        let results = tarrantData.searchByAddress(street, 5);
        
        // If no results, try fuzzy: strip suffix (Dr/Ln/Ave/St/Ct/Rd/Blvd/Way/Trl/Cir)
        if (results.length === 0) {
            const stripped = street.replace(/\s+(DR|LN|AVE|ST|CT|RD|BLVD|WAY|TRL|CIR|PL|LOOP|PKWY|HWY|DRIVE|LANE|AVENUE|STREET|COURT|ROAD|BOULEVARD|TRAIL|CIRCLE|PLACE)\.?$/i, '');
            if (stripped !== street) {
                console.log(`[Tarrant] Exact match failed, trying fuzzy without suffix: "${stripped}"`);
                results = tarrantData.searchByAddress(stripped, 5);
            }
        }
        
        // Map to expected format
        return results.map(r => ({
            accountId: r.accountNumber,
            address: r.address,
            assessedValue: r.appraisedValue,
            landValue: r.landValue,
            improvementValue: r.improvementValue,
            sqft: r.sqft,
            yearBuilt: r.yearBuilt,
            bedrooms: r.bedrooms,
            bathrooms: r.bathrooms,
            hasPool: r.hasPool,
            propertyClass: r.propertyClass,
            propertyType: r.propertyClassDesc,
            legalDescription: r.legalDescription,
            source: 'tarrant-cad-local'
        }));
    },
    async getPropertyDetails(accountIdOrUrl) {
        if (!tarrantData.isLoaded()) await tarrantData.loadData();
        const rec = tarrantData.lookupAccount(accountIdOrUrl);
        if (!rec) return null;
        return {
            source: 'tarrant-cad-local',
            fetchedAt: new Date().toISOString(),
            accountId: rec.accountNumber,
            ownerName: null, // Not in compact data
            address: rec.address,
            legalDescription: rec.legalDescription,
            propertyType: rec.propertyClassDesc,
            neighborhoodCode: null,
            sqft: rec.sqft,
            yearBuilt: rec.yearBuilt,
            bedrooms: rec.bedrooms,
            bathrooms: rec.bathrooms,
            lotSize: null,
            assessedValue: rec.appraisedValue,
            landValue: rec.landValue,
            improvementValue: rec.improvementValue,
            exemptions: null,
            valueHistory: null
        };
    }
};
registerAdapter('tarrant', tarrantAdapter);

// ===== BIS CONSULTANTS E-SEARCH HELPER =====
// Shared by FBCAD and TCAD — same platform, different base URLs
function createBISAdapter({ name, code, baseUrl }) {
    return {
        name,
        code,
        baseUrl,

        _parseAddress(address) {
            const cleaned = (address || '').replace(/,.*$/, '').trim();
            const parts = cleaned.split(/\s+/);
            let streetNumber = '';
            let streetName = '';
            if (parts.length > 1 && /^\d+$/.test(parts[0])) {
                streetNumber = parts.shift();
            }
            // Remove common suffixes for search
            const suffixes = ['st', 'street', 'dr', 'drive', 'ln', 'lane', 'ct', 'court', 'blvd', 'ave', 'avenue', 'rd', 'road', 'way', 'pl', 'place', 'cir', 'circle', 'pkwy', 'parkway'];
            if (parts.length > 1 && suffixes.includes(parts[parts.length - 1].toLowerCase())) parts.pop();
            streetName = parts.join(' ');
            return { streetNumber, streetName };
        },

        async searchByAddress(address) {
            try {
                const { streetNumber, streetName } = this._parseAddress(address);
                if (!streetName) return [];

                const currentYear = new Date().getFullYear();
                let keywords = `StreetName:${streetName} Year:${currentYear}`;
                if (streetNumber) keywords = `StreetNumber:${streetNumber} ${keywords}`;

                const searchUrl = `${this.baseUrl}/Search/Result?keywords=${encodeURIComponent(keywords)}`;
                console.log(`[${this.code}] Searching: ${searchUrl}`);

                const res = await axios.get(searchUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'text/html,application/xhtml+xml'
                    },
                    timeout: 60000
                });

                const $ = cheerio.load(res.data);
                const properties = [];

                // BIS e-search returns a table with columns:
                // Quick Ref ID, Geo ID, Type, Owner Name, Owner ID, Situs Address, Appraised
                $('table tbody tr, table.table tr').each((i, row) => {
                    const cells = $(row).find('td');
                    if (cells.length < 6) return;

                    const quickRefId = cells.eq(0).text().trim();
                    const geoId = cells.eq(1).text().trim();
                    const type = cells.eq(2).text().trim();
                    const ownerName = cells.eq(3).text().trim();
                    const situsAddress = cells.eq(5).text().trim();
                    const appraised = cells.eq(6).text().trim();

                    if (!quickRefId || /quick\s*ref/i.test(quickRefId)) return; // skip header rows

                    const link = cells.eq(0).find('a');
                    const href = link.attr('href') || '';

                    properties.push({
                        accountId: quickRefId,
                        geoId,
                        address: situsAddress,
                        ownerName,
                        propertyType: type,
                        assessedValue: parseFloat((appraised || '0').replace(/[$,\s]/g, '')) || null,
                        detailUrl: href ? (href.startsWith('http') ? href : `${this.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`) : `${this.baseUrl}/Property/View/${quickRefId}`
                    });
                });

                console.log(`[${this.code}] Found ${properties.length} results`);
                return properties;
            } catch (error) {
                console.error(`[${this.code}] Search failed:`, error.message);
                return [];
            }
        },

        async getPropertyDetails(accountIdOrUrl) {
            try {
                let url = accountIdOrUrl;
                if (!url.startsWith('http')) {
                    url = `${this.baseUrl}/Property/View/${accountIdOrUrl}`;
                }

                console.log(`[${this.code}] Fetching details: ${url}`);

                const res = await axios.get(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'text/html,application/xhtml+xml'
                    },
                    timeout: 60000
                });

                const $ = cheerio.load(res.data);

                // BIS detail pages use label/value pairs in various formats
                const getText = (...labels) => {
                    for (const label of labels) {
                        // Try table rows with th/td pairs
                        $('th, td, dt, label, span.label, strong').each(function () {
                            const el = $(this);
                            if (el.text().trim().toLowerCase().includes(label.toLowerCase())) {
                                const next = el.next();
                                const val = next.text().trim();
                                if (val && val.toLowerCase() !== label.toLowerCase()) {
                                    getText._result = val;
                                    return false; // break .each()
                                }
                                // Try parent's next sibling
                                const parentNext = el.parent().next();
                                const pVal = parentNext.text().trim();
                                if (pVal) {
                                    getText._result = pVal;
                                    return false;
                                }
                            }
                        });
                        if (getText._result) {
                            const r = getText._result;
                            getText._result = null;
                            return r;
                        }
                    }
                    return null;
                };
                getText._result = null;

                const getNumeric = (...labels) => {
                    const text = getText(...labels);
                    if (!text) return null;
                    const num = parseFloat(text.replace(/[$,\s]/g, ''));
                    return isNaN(num) ? null : num;
                };

                const data = {
                    source: this.code,
                    fetchedAt: new Date().toISOString(),
                    accountId: getText('Quick Ref', 'Account', 'Prop ID', 'Property ID') ||
                               accountIdOrUrl.replace(/.*\//, ''),
                    ownerName: getText('Owner Name', 'Owner'),
                    address: getText('Situs Address', 'Address', 'Property Address', 'Situs'),
                    legalDescription: getText('Legal Description', 'Legal'),
                    propertyType: normalizePropertyType(getText('Type', 'Property Type', 'State Category', 'Improvement Type')),
                    neighborhoodCode: getText('Neighborhood', 'Nbhd', 'Map ID'),
                    sqft: getNumeric('Living Area', 'Square Feet', 'SqFt', 'Total Living Area', 'Heated Area', 'GLA'),
                    yearBuilt: getNumeric('Year Built', 'Yr Built', 'Year Blt'),
                    bedrooms: getNumeric('Bedrooms', 'Beds'),
                    bathrooms: getNumeric('Bathrooms', 'Baths', 'Full Baths'),
                    lotSize: getNumeric('Lot Size', 'Land Area', 'Acres', 'Land SqFt'),
                    assessedValue: getNumeric('Appraised Value', 'Total Value', 'Market Value', 'Assessed Value', 'Total Appraised'),
                    landValue: getNumeric('Land Value', 'Land Appraised', 'Land Market'),
                    improvementValue: getNumeric('Improvement Value', 'Impr Value', 'Impr Appraised', 'Improvement Market'),
                    exemptions: getText('Exemptions', 'Exemption'),
                    valueHistory: this._parseValueHistory($)
                };

                return data;
            } catch (error) {
                console.error(`[${this.code}] Detail fetch failed:`, error.message);
                return null;
            }
        },

        async searchComparables(subject) {
            // Comps come from comp-engine.js; return empty
            return [];
        },

        _parseValueHistory($) {
            const history = [];
            $('table').each((_, table) => {
                const headerText = $(table).find('th, td').first().text().toLowerCase();
                if (headerText.includes('year') || headerText.includes('history') || headerText.includes('value')) {
                    $(table).find('tr').each((i, row) => {
                        if (i === 0) return;
                        const cells = $(row).find('td');
                        if (cells.length >= 2) {
                            const year = parseInt(cells.eq(0).text().trim());
                            const value = parseFloat(cells.eq(1).text().replace(/[$,]/g, ''));
                            if (year && value) history.push({ year, value });
                        }
                    });
                }
            });
            return history.length ? history : null;
        }
    };
}

// ===== FORT BEND COUNTY (FBCAD) — BIS e-search =====
registerAdapter('fort bend', createBISAdapter({
    name: 'Fort Bend Central Appraisal District',
    code: 'FBCAD',
    baseUrl: 'https://esearch.fbcad.org'
}));

// ===== TRAVIS COUNTY (TCAD) — BIS e-search =====
registerAdapter('travis', createBISAdapter({
    name: 'Travis Central Appraisal District',
    code: 'TCAD',
    baseUrl: 'https://esearch.austincad.org'
}));

// ===== DALLAS COUNTY (DCAD) — Local Data (858K parcels) =====
const { LocalCADData } = require('./local-cad-data');
const dallasData = new LocalCADData('Dallas', path.join(__dirname, '..', 'data', 'dallas', 'parcels-compact.jsonl.gz'));
registerAdapter('dallas', {
    name: 'Dallas CAD (Local Data)',
    async searchByAddress(address) {
        if (!dallasData.isLoaded()) await dallasData.loadData();
        const streetMatch = (address || '').match(/^[\d]+\s+[^,]+/);
        const street = streetMatch ? streetMatch[0].toUpperCase().trim() : (address || '').toUpperCase().trim();
        let results = dallasData.searchByAddress(street, 5);
        return results.map(r => ({
            accountId: r.accountNumber, address: r.address, assessedValue: r.appraisedValue,
            landValue: r.landValue, improvementValue: r.improvementValue, sqft: r.sqft,
            yearBuilt: r.yearBuilt, bedrooms: r.bedrooms, bathrooms: r.bathrooms,
            hasPool: r.hasPool, propertyClass: r.propertyClass, legalDescription: r.legalDescription,
            source: 'dallas-cad-local'
        }));
    },
    async getPropertyDetails(accountId) {
        if (!dallasData.isLoaded()) await dallasData.loadData();
        const rec = dallasData.lookupAccount(accountId);
        if (!rec) return null;
        return {
            source: 'dallas-cad-local', fetchedAt: new Date().toISOString(),
            accountId: rec.accountNumber, address: rec.address, propertyType: rec.propertyClass,
            sqft: rec.sqft, yearBuilt: rec.yearBuilt, assessedValue: rec.appraisedValue,
            landValue: rec.landValue, improvementValue: rec.improvementValue,
            legalDescription: rec.legalDescription
        };
    }
});

// ===== COLLIN COUNTY (CCAD) — BIS e-search =====
registerAdapter('collin', createBISAdapter({
    name: 'Collin Central Appraisal District',
    code: 'CCAD',
    baseUrl: 'https://esearch.collincad.org'
}));

// ===== WILLIAMSON COUNTY (WCAD) — BIS e-search =====
registerAdapter('williamson', createBISAdapter({
    name: 'Williamson Central Appraisal District',
    code: 'WCAD',
    baseUrl: 'https://esearch.williamsoncad.org'
}));

// ===== MONTGOMERY COUNTY (MCAD) — BIS e-search =====
registerAdapter('montgomery', createBISAdapter({
    name: 'Montgomery Central Appraisal District',
    code: 'MCAD',
    baseUrl: 'https://esearch.montgomerycad.org'
}));

// ===== HUNT COUNTY (HCAD-Hunt) — BIS e-search =====
registerAdapter('hunt', createBISAdapter({
    name: 'Hunt County Appraisal District',
    code: 'HUNT',
    baseUrl: 'https://esearch.huntcad.org'
}));

// ===== KAUFMAN COUNTY (KCAD) — BIS e-search =====
registerAdapter('kaufman', createBISAdapter({
    name: 'Kaufman County Appraisal District',
    code: 'KCAD',
    baseUrl: 'https://esearch.kaufman-cad.org'
}));

// ===== HARRIS COUNTY (HCAD) =====
registerAdapter('harris', {
    name: 'Harris County Appraisal District',
    code: 'HCAD',
    baseUrl: 'https://public.hcad.org',

    _parseAddress(address) {
        const cleaned = (address || '').replace(/,.*$/, '').trim();
        const parts = cleaned.split(/\s+/);
        let streetNumber = '';
        if (parts.length > 1 && /^\d+$/.test(parts[0])) {
            streetNumber = parts.shift();
        }
        const suffixes = ['st', 'street', 'dr', 'drive', 'ln', 'lane', 'ct', 'court', 'blvd', 'ave', 'avenue', 'rd', 'road', 'way', 'pl', 'place', 'cir', 'circle', 'pkwy', 'parkway'];
        if (parts.length > 1 && suffixes.includes(parts[parts.length - 1].toLowerCase())) parts.pop();
        return { streetNumber, streetName: parts.join(' ') };
    },

    async searchByAddress(address) {
        // HCAD's public site is unreliable. Try the public search, fall back gracefully.
        try {
            const { streetNumber, streetName } = this._parseAddress(address);
            if (!streetName) return [];

            // Try HCAD's public property search
            const searchUrl = `https://public.hcad.org/records/Real.asp?search=addr&stnum=${encodeURIComponent(streetNumber)}&stname=${encodeURIComponent(streetName)}&sttype=&stsfx=`;
            console.log(`[HCAD] Searching: ${searchUrl}`);

            const res = await axios.get(searchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml'
                },
                timeout: 60000,
                maxRedirects: 5
            });

            const $ = cheerio.load(res.data);
            const properties = [];

            // HCAD returns results in a table
            $('table tr').each((i, row) => {
                if (i === 0) return; // skip header
                const cells = $(row).find('td');
                if (cells.length < 3) return;

                const link = $(row).find('a');
                const href = link.attr('href') || '';
                const accountId = link.text().trim() || cells.eq(0).text().trim();
                const propAddress = cells.eq(1).text().trim();
                const ownerName = cells.eq(2).text().trim();

                if (accountId && !/account/i.test(accountId)) {
                    properties.push({
                        accountId,
                        address: propAddress,
                        ownerName,
                        detailUrl: href ? (href.startsWith('http') ? href : `https://public.hcad.org/records/${href}`) : null
                    });
                }
            });

            console.log(`[HCAD] Found ${properties.length} results`);
            return properties;
        } catch (error) {
            console.error(`[HCAD] Search failed (site may be down):`, error.message);
            return [];
        }
    },

    async getPropertyDetails(accountIdOrUrl) {
        try {
            let url = accountIdOrUrl;
            if (!url.startsWith('http')) {
                url = `https://public.hcad.org/records/details.asp?cession=A&theession=${accountIdOrUrl}`;
            }

            console.log(`[HCAD] Fetching details: ${url}`);

            const res = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml'
                },
                timeout: 60000,
                maxRedirects: 5
            });

            const $ = cheerio.load(res.data);

            const getText = (...labels) => {
                for (const label of labels) {
                    const found = $('td, th, span, label, div, font').filter(function () {
                        return $(this).text().trim().toLowerCase().includes(label.toLowerCase());
                    });
                    if (found.length) {
                        const next = found.first().next();
                        const text = next.text().trim();
                        if (text && text.toLowerCase() !== label.toLowerCase()) return text;
                        const parentNext = found.first().parent().next();
                        const pText = parentNext.text().trim();
                        if (pText) return pText;
                    }
                }
                return null;
            };

            const getNumeric = (...labels) => {
                const text = getText(...labels);
                if (!text) return null;
                const num = parseFloat(text.replace(/[$,\s]/g, ''));
                return isNaN(num) ? null : num;
            };

            return {
                source: 'HCAD',
                fetchedAt: new Date().toISOString(),
                accountId: getText('Account', 'Account Number') || accountIdOrUrl.replace(/.*=/, ''),
                ownerName: getText('Owner Name', 'Owner'),
                address: getText('Property Address', 'Address', 'Site Address'),
                legalDescription: getText('Legal Description', 'Legal'),
                propertyType: normalizePropertyType(getText('State Class', 'Type', 'Property Type', 'Building Type')),
                neighborhoodCode: getText('Neighborhood', 'Nbhd'),
                sqft: getNumeric('Building Area', 'Living Area', 'Square Feet', 'Total Area'),
                yearBuilt: getNumeric('Year Built', 'Yr Built'),
                bedrooms: getNumeric('Bedrooms', 'Beds'),
                bathrooms: getNumeric('Bathrooms', 'Baths'),
                lotSize: getNumeric('Lot Size', 'Land Area', 'Land Size'),
                assessedValue: getNumeric('Appraised Value', 'Total Value', 'Total Appraised', 'Market Value'),
                landValue: getNumeric('Land Value', 'Land Appraised'),
                improvementValue: getNumeric('Improvement Value', 'Impr Value', 'Bldg Value'),
                exemptions: getText('Exemptions', 'Exemption'),
                valueHistory: null // HCAD detail pages don't reliably show history
            };
        } catch (error) {
            console.error(`[HCAD] Detail fetch failed (site may be down):`, error.message);
            return null;
        }
    },

    async searchComparables(subject) {
        // Comps come from comp-engine.js; return empty
        return [];
    }
});

// ===== GENERIC LOCAL BULK DATA ADAPTER =====
// For counties with loaded parcel data but no web scraper (WA, GA, CO, AZ)
function createLocalBulkAdapter(countyName, displayName) {
    return {
        name: displayName,
        code: countyName.toUpperCase(),
        async searchByAddress(address) {
            const localData = getCountyData(countyName);
            if (!localData || !localData.isLoaded()) {
                console.log(`[${countyName}] Local data not loaded`);
                return [];
            }
            const results = localData.searchByAddress(address);
            if (results && results.length > 0) {
                return results.map(r => ({ ...r, _source: 'local-bulk' }));
            }
            return [];
        },
        async getPropertyDetails(accountId) { return null; },
        async searchComparables() { return []; }
    };
}

// Register multi-state counties with local bulk data
const localBulkCounties = [
    ['king', 'King County Assessor (WA)'],
    ['pierce', 'Pierce County Assessor (WA)'],
    ['fulton', 'Fulton County Tax Assessor (GA)'],
    ['dekalb', 'DeKalb County Tax Assessor (GA)'],
    ['denver', 'Denver County Assessor (CO)'],
    ['el-paso', 'El Paso County Assessor (CO)'],
    ['maricopa', 'Maricopa County Assessor (AZ)'],
    ['coconino', 'Coconino County Assessor (AZ)'],
    ['clark', 'Clark County Assessor'],
];
localBulkCounties.forEach(([county, name]) => {
    if (!countyAdapters[county]) {
        registerAdapter(county, createLocalBulkAdapter(county, name));
    }
});

// ===== MAIN API =====

/**
 * Detect county from address (default: Bexar)
 */
function detectCounty(address, state) {
    const addr = (address || '').toLowerCase();
    const st = (state || '').toUpperCase();
    
    // WA state detection
    if (st === 'WA' || addr.includes(', wa') || addr.includes('washington')) {
        if (addr.includes('kenmore') || addr.includes('seattle') || addr.includes('bellevue') || addr.includes('redmond') || addr.includes('kirkland') || addr.includes('renton') || addr.includes('bothell') || addr.includes('woodinville') || addr.includes('sammamish') || addr.includes('issaquah') || addr.includes('mercer island') || addr.includes('shoreline') || addr.includes('burien') || addr.includes('tukwila') || addr.includes('seatac') || addr.includes('king')) return 'king';
        if (addr.includes('tacoma') || addr.includes('puyallup') || addr.includes('lakewood') || addr.includes('bonney lake') || addr.includes('pierce')) return 'pierce';
        return 'king'; // Default WA to King County
    }
    // GA state detection
    if (st === 'GA' || addr.includes(', ga') || addr.includes('georgia')) {
        if (addr.includes('atlanta') || addr.includes('fulton') || addr.includes('sandy springs') || addr.includes('roswell') || addr.includes('alpharetta') || addr.includes('johns creek') || addr.includes('milton')) return 'fulton';
        if (addr.includes('decatur') || addr.includes('dekalb') || addr.includes('stone mountain') || addr.includes('dunwoody') || addr.includes('brookhaven') || addr.includes('tucker')) return 'dekalb';
        return 'fulton'; // Default GA to Fulton County
    }
    // CO state detection  
    if (st === 'CO' || addr.includes(', co') || addr.includes('colorado')) {
        if (addr.includes('denver')) return 'denver';
        if (addr.includes('el paso') || addr.includes('colorado springs')) return 'el-paso';
        return 'denver'; // Default CO to Denver
    }
    // AZ state detection
    if (st === 'AZ' || addr.includes(', az') || addr.includes('arizona')) {
        if (addr.includes('phoenix') || addr.includes('scottsdale') || addr.includes('tempe') || addr.includes('mesa') || addr.includes('chandler') || addr.includes('glendale') || addr.includes('maricopa')) return 'maricopa';
        return 'maricopa'; // Default AZ to Maricopa
    }
    if (addr.includes('houston') || addr.includes('harris')) return 'harris';
    if (addr.includes('austin') || addr.includes('travis') || addr.includes('pflugerville') || addr.includes('round rock') || addr.includes('cedar park')) return 'travis';
    if (addr.includes('fort bend') || addr.includes('richmond') || addr.includes('sugar land') || addr.includes('sugarland') || addr.includes('katy') || addr.includes('missouri city') || addr.includes('rosenberg') || addr.includes('stafford') || addr.includes('fulshear')) return 'fort bend';
    if (addr.includes('fort worth') || addr.includes('arlington') || addr.includes('bedford') || addr.includes('euless') || addr.includes('hurst') || addr.includes('tarrant') || addr.includes('grapevine') || addr.includes('colleyville') || addr.includes('mansfield') || addr.includes('north richland hills') || addr.includes('keller') || addr.includes('southlake') || addr.includes('watauga') || addr.includes('haltom city') || addr.includes('saginaw') || addr.includes('white settlement') || addr.includes('benbrook') || addr.includes('crowley') || addr.includes('forest hill') || addr.includes('kennedale') || addr.includes('lake worth') || addr.includes('river oaks') || addr.includes('westworth village') || addr.includes('azle')) return 'tarrant';
    if (addr.includes('collin') || addr.includes('mckinney') || addr.includes('frisco') || addr.includes('plano') || addr.includes('anna') || addr.match(/\ballen\b/) || addr.includes('prosper') || addr.includes('celina') || addr.includes('wylie') || addr.includes('murphy') || addr.includes('fairview') || addr.includes('princeton') || addr.includes('lucas')) return 'collin';
    if (addr.includes('dallas') || addr.includes('garland') || addr.includes('mesquite') || addr.includes('irving') || addr.includes('richardson') || addr.includes('carrollton') || addr.includes('farmers branch') || addr.includes('desoto') || addr.includes('duncanville') || addr.includes('cedar hill') || addr.includes('lancaster') || addr.includes('glenn heights') || addr.includes('rowlett') || addr.includes('sachse') || addr.includes('coppell') || addr.includes('grand prairie') || addr.includes('balch springs')) return 'dallas';
    if (addr.includes('denton') || addr.includes('lewisville') || addr.includes('flower mound') || addr.includes('little elm') || addr.includes('the colony') || addr.includes('corinth') || addr.includes('highland village') || addr.includes('argyle') || addr.includes('aubrey') || addr.includes('sanger')) return 'denton';
    if (addr.includes('forney') || addr.includes('kaufman') || addr.includes('terrell')) return 'kaufman';
    if (addr.includes('greenville') || addr.includes('hunt county') || /\bcommerce,/.test(addr) || addr.includes('quinlan') || addr.includes('caddo mills') || addr.includes('wolfe city')) return 'hunt';
    if (addr.includes('williamson') || addr.includes('georgetown') || addr.includes('taylor') || addr.includes('jarrell') || addr.includes('liberty hill') || addr.includes('hutto') || addr.includes('granger') || addr.includes('bartlett') || addr.includes('thrall')) return 'williamson';
    if (addr.includes('montgomery') || addr.includes('conroe') || addr.includes('the woodlands') || addr.includes('magnolia') || addr.includes('willis') || addr.includes('new caney') || addr.includes('spring') || addr.includes('tomball') || addr.includes('porter') || addr.includes('huntsville') || addr.includes('splendora')) return 'montgomery';
    if (addr.includes('guadalupe') || addr.includes('seguin') || addr.includes('schertz') || addr.includes('cibolo') || addr.includes('new braunfels') || addr.includes('marion')) return 'guadalupe';
    if (addr.includes('comal') || addr.includes('bulverde') || addr.includes('canyon lake') || addr.includes('garden ridge') || addr.includes('spring branch')) return 'comal';
    if (addr.includes('hays') || addr.includes('san marcos') || addr.includes('kyle') || addr.includes('buda') || addr.includes('wimberley') || addr.includes('dripping springs')) return 'hays';
    if (addr.includes('hidalgo') || addr.includes('mcallen') || addr.includes('edinburg') || addr.includes('pharr') || addr.includes('mission') || addr.includes('weslaco') || addr.includes('donna') || addr.includes('alamo') || addr.includes('mercedes') || addr.includes('san juan')) return 'hidalgo';
    if (addr.includes('el paso') || addr.includes('canutillo') || addr.includes('horizon city') || addr.includes('socorro') || addr.includes('anthony') || addr.includes('clint')) return 'el paso';
    // Galveston County
    if (addr.includes('san leon') || addr.includes('league city') || addr.includes('dickinson') || addr.includes('la marque') || addr.includes('texas city') || addr.includes('galveston') || addr.includes('kemah') || addr.includes('friendswood') || addr.includes('santa fe')) return 'galveston';
    // Bexar — only when address explicitly indicates San Antonio
    if (addr.includes('san antonio') || addr.includes('bexar') || addr.includes('helotes') || addr.includes('converse') || addr.includes('live oak') || addr.includes('leon valley') || addr.includes('windcrest') || addr.includes('kirby') || addr.includes('castle hills') || addr.includes('shavano park') || addr.includes('terrell hills')) return 'bexar';
    // Unknown — do not default, let caller handle
    return null;
}

/**
 * Fetch property data for a case
 */
async function fetchPropertyData(caseData) {
    // Use explicit county from caseData if available, otherwise detect from address
    let county = caseData.county ? caseData.county.toLowerCase().replace(' county', '').trim() : null;
    if (!county) county = detectCounty(caseData.propertyAddress, caseData.state);
    const adapter = getAdapter(county);
    if (!adapter) throw new Error(`No adapter for county: ${county}`);

    console.log(`[PropertyData] Fetching from ${adapter.name} for: ${caseData.propertyAddress}`);

    // Try scraping first
    let propertyData = null;
    try {
        const results = await adapter.searchByAddress(caseData.propertyAddress);
        if (results.length > 0) {
            const result = results[0];
            // If result came from local bulk data, use it directly (no network call needed)
            if (result._source === 'local-bulk' && result.assessedValue) {
                console.log(`[PropertyData] Using local bulk data for ${caseData.propertyAddress}`);
                propertyData = {
                    source: 'local-bulk',
                    fetchedAt: new Date().toISOString(),
                    accountId: result.accountId,
                    ownerName: result.ownerName,
                    address: result.address,
                    legalDescription: result.legalDescription,
                    propertyType: normalizePropertyType(result.propertyType) || 'Single Family Home',
                    neighborhoodCode: result.neighborhoodCode,
                    sqft: result.sqft ? parseInt(result.sqft) : null,
                    yearBuilt: result.yearBuilt ? parseInt(result.yearBuilt) : null,
                    assessedValue: result.assessedValue,
                    landValue: result.landValue || Math.round(result.assessedValue * 0.25),
                    improvementValue: result.improvementValue || Math.round(result.assessedValue * 0.75),
                    exemptions: result.exemptions,
                    valueHistory: _generateEstimatedHistory(result.assessedValue)
                };
            } else if (result.detailUrl) {
                propertyData = await adapter.getPropertyDetails(result.detailUrl);
            } else if (result.accountId) {
                propertyData = await adapter.getPropertyDetails(result.accountId);
            }
        }
    } catch (err) {
        console.error(`[PropertyData] Scrape failed: ${err.message}`);
    }

    // Fallback: build from case data + reasonable estimates
    // ⚠️ This means the real CAD lookup FAILED — numbers may be inaccurate
    if (!propertyData || !propertyData.assessedValue) {
        console.warn(`[PropertyData] ⚠️ FALLBACK — No real CAD data for ${caseData.propertyAddress} (county: ${county}). Flagging for manual review.`);
        caseData._needsManualReview = true;
        caseData._reviewReason = `CAD lookup failed for county "${county}" — using intake-provided data. Values may be inaccurate.`;
        const assessedNum = parseInt((caseData.assessedValue || '0').replace(/[^0-9]/g, '')) || 300000;
        propertyData = {
            source: 'intake-fallback',
            fetchedAt: new Date().toISOString(),
            accountId: caseData.pin || null,
            ownerName: caseData.ownerName,
            address: caseData.propertyAddress,
            legalDescription: null,
            propertyType: normalizePropertyType(caseData.propertyType) || 'Single Family Home',
            neighborhoodCode: null,
            sqft: caseData.sqft ? parseInt(caseData.sqft) : null,
            yearBuilt: caseData.yearBuilt ? parseInt(caseData.yearBuilt) : null,
            bedrooms: caseData.bedrooms ? parseInt(caseData.bedrooms) : null,
            bathrooms: caseData.bathrooms ? parseFloat(caseData.bathrooms) : null,
            lotSize: null,
            assessedValue: assessedNum,
            landValue: Math.round(assessedNum * 0.25),
            improvementValue: Math.round(assessedNum * 0.75),
            exemptions: null,
            valueHistory: _generateEstimatedHistory(assessedNum)
        };
    }

    // Ensure value history exists
    if (!propertyData.valueHistory || propertyData.valueHistory.length === 0) {
        propertyData.valueHistory = _generateEstimatedHistory(propertyData.assessedValue);
    }

    return propertyData;
}

function _generateEstimatedHistory(currentValue) {
    const currentYear = new Date().getFullYear();
    const history = [];
    let val = currentValue;
    for (let i = 0; i < 5; i++) {
        history.push({ year: currentYear - i, value: Math.round(val) });
        val = val / (1 + (0.05 + Math.random() * 0.05)); // ~5-10% annual increase backward
    }
    return history;
}

module.exports = {
    fetchPropertyData,
    detectCounty,
    getAdapter,
    registerAdapter,
    countyAdapters,
    normalizePropertyType
};
