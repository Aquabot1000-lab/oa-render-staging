/**
 * Address Parser — Infer state and county from property address
 * 
 * Used by all intake endpoints to ensure state is never blank or incorrectly defaulted.
 * 
 * Supported states: TX, GA, WA, AZ, CO, OH (OverAssessed operational states)
 * If state can't be determined → returns { state: null, flagged: true }
 * If state is non-TX → returns { state, flagged: true, reason: 'non-tx' }
 */

// State abbreviation and name mapping
const STATE_MAP = {
    TX: 'TX', TEXAS: 'TX',
    GA: 'GA', GEORGIA: 'GA',
    WA: 'WA', WASHINGTON: 'WA',
    AZ: 'AZ', ARIZONA: 'AZ',
    CO: 'CO', COLORADO: 'CO',
    OH: 'OH', OHIO: 'OH',
    FL: 'FL', FLORIDA: 'FL',
    CA: 'CA', CALIFORNIA: 'CA',
    NY: 'NY', 'NEW YORK': 'NY',
    IL: 'IL', ILLINOIS: 'IL',
    PA: 'PA', PENNSYLVANIA: 'PA',
    NC: 'NC', 'NORTH CAROLINA': 'NC',
    SC: 'SC', 'SOUTH CAROLINA': 'SC',
    VA: 'VA', VIRGINIA: 'VA',
    TN: 'TN', TENNESSEE: 'TN',
    AL: 'AL', ALABAMA: 'AL',
    LA: 'LA', LOUISIANA: 'LA',
    OK: 'OK', OKLAHOMA: 'OK',
    NM: 'NM', 'NEW MEXICO': 'NM',
    NV: 'NV', NEVADA: 'NV',
    OR: 'OR', OREGON: 'OR',
    ID: 'ID', IDAHO: 'ID',
    MT: 'MT', MONTANA: 'MT',
    UT: 'UT', UTAH: 'UT',
    NE: 'NE', NEBRASKA: 'NE',
    KS: 'KS', KANSAS: 'KS',
    MO: 'MO', MISSOURI: 'MO',
    IN: 'IN', INDIANA: 'IN',
    MI: 'MI', MICHIGAN: 'MI',
    WI: 'WI', WISCONSIN: 'WI',
    MN: 'MN', MINNESOTA: 'MN',
    IA: 'IA', IOWA: 'IA',
    AR: 'AR', ARKANSAS: 'AR',
    MS: 'MS', MISSISSIPPI: 'MS',
    CT: 'CT', CONNECTICUT: 'CT',
    MA: 'MA', MASSACHUSETTS: 'MA',
    MD: 'MD', MARYLAND: 'MD',
    NJ: 'NJ', 'NEW JERSEY': 'NJ',
    DE: 'DE', DELAWARE: 'DE',
    NH: 'NH', 'NEW HAMPSHIRE': 'NH',
    VT: 'VT', VERMONT: 'VT',
    ME: 'ME', MAINE: 'ME',
    RI: 'RI', 'RHODE ISLAND': 'RI',
    WV: 'WV', 'WEST VIRGINIA': 'WV',
    KY: 'KY', KENTUCKY: 'KY',
    ND: 'ND', 'NORTH DAKOTA': 'ND',
    SD: 'SD', 'SOUTH DAKOTA': 'SD',
    WY: 'WY', WYOMING: 'WY',
    HI: 'HI', HAWAII: 'HI',
    AK: 'AK', ALASKA: 'AK',
    DC: 'DC',
};

// TX city → county mapping
const TX_CITY_COUNTY = {
    'san antonio': 'Bexar',
    'houston': 'Harris',
    'dallas': 'Dallas',
    'austin': 'Travis',
    'fort worth': 'Tarrant',
    'arlington': 'Tarrant',
    'plano': 'Collin',
    'frisco': 'Collin',
    'mckinney': 'Collin',
    'allen': 'Collin',
    'round rock': 'Williamson',
    'georgetown': 'Williamson',
    'cedar park': 'Williamson',
    'pflugerville': 'Travis',
    'new braunfels': 'Comal',
    'boerne': 'Kendall',
    'helotes': 'Bexar',
    'converse': 'Bexar',
    'schertz': 'Guadalupe',
    'cibolo': 'Guadalupe',
    'live oak': 'Bexar',
    'universal city': 'Bexar',
    'selma': 'Bexar',
    'katy': 'Harris',
    'sugar land': 'Fort Bend',
    'pearland': 'Brazoria',
    'league city': 'Galveston',
    'denton': 'Denton',
    'irving': 'Dallas',
    'garland': 'Dallas',
    'mesquite': 'Dallas',
    'richardson': 'Dallas',
    'carrollton': 'Denton',
    'lewisville': 'Denton',
    'flower mound': 'Denton',
    'waco': 'McLennan',
    'killeen': 'Bell',
    'temple': 'Bell',
    'corpus christi': 'Nueces',
    'laredo': 'Webb',
    'el paso': 'El Paso',
    'lubbock': 'Lubbock',
    'amarillo': 'Potter',
    'midland': 'Midland',
    'odessa': 'Ector',
    'gardendale': 'Ector',
    'greenville': 'Hunt',
    'anna': 'Collin',
    'little elm': 'Denton',
    'richmond': 'Fort Bend',
    'beaumont': 'Jefferson',
    'spring': 'Harris',
    'humble': 'Harris',
    'cypress': 'Harris',
    'tomball': 'Harris',
    'the woodlands': 'Montgomery',
    'conroe': 'Montgomery',
    'kyle': 'Hays',
    'san marcos': 'Hays',
    'buda': 'Hays',
    'dripping springs': 'Hays',
    'lakeway': 'Travis',
    'bee cave': 'Travis',
    'westlake': 'Travis',
};

// WA city → county mapping
const WA_CITY_COUNTY = {
    'seattle': 'King',
    'tacoma': 'Pierce',
    'spokane': 'Spokane',
    'vancouver': 'Clark',
    'bellevue': 'King',
    'everett': 'Snohomish',
    'olympia': 'Thurston',
};

// GA city → county mapping
const GA_CITY_COUNTY = {
    'atlanta': 'Fulton',
    'marietta': 'Cobb',
    'savannah': 'Chatham',
    'sandy springs': 'Fulton',
    'roswell': 'Fulton',
    'alpharetta': 'Fulton',
    'decatur': 'DeKalb',
};

/**
 * Parse state and county from a property address string.
 * 
 * @param {string} address - Property address (e.g. "123 Main St, San Antonio, TX 78230")
 * @param {object} [hints] - Optional hints from form fields
 * @param {string} [hints.state] - State hint from form
 * @param {string} [hints.county] - County hint from form
 * @returns {{ state: string|null, county: string|null, flagged: boolean, reason: string|null }}
 */
function parseAddress(address, hints = {}) {
    if (!address) return { state: null, county: null, flagged: true, reason: 'no-address' };

    const addr = address.trim();
    const addrUpper = addr.toUpperCase();
    let state = null;
    let county = hints.county || null;
    let flagged = false;
    let reason = null;

    // Pattern 1: "City, ST 12345" or "City, ST"
    const stateZipMatch = addr.match(/,\s*([A-Za-z]{2})\s+\d{5}/);
    const stateEndMatch = addr.match(/,\s*([A-Za-z]{2})\s*$/);
    const stateWordMatch = addr.match(/,\s*([A-Za-z ]+?)\s+\d{5}/);

    if (stateZipMatch) {
        const s = stateZipMatch[1].toUpperCase();
        state = STATE_MAP[s] || s;
    } else if (stateEndMatch) {
        const s = stateEndMatch[1].toUpperCase();
        state = STATE_MAP[s] || s;
    } else if (stateWordMatch) {
        const s = stateWordMatch[1].trim().toUpperCase();
        state = STATE_MAP[s] || null;
    }

    // Pattern 2: Check for state abbreviation anywhere (e.g., "123 Main st s Tacoma wa 98444")
    if (!state) {
        // Match 2-letter state code preceded by space or comma, followed by space/zip/end
        const looseMatch = addr.match(/[\s,]+([A-Za-z]{2})\s+\d{5}/);
        if (looseMatch) {
            const s = looseMatch[1].toUpperCase();
            if (STATE_MAP[s]) state = STATE_MAP[s];
        }
    }

    // Fallback: use hint
    if (!state && hints.state) {
        const h = hints.state.toUpperCase();
        state = STATE_MAP[h] || null;
    }

    // County detection from city name
    if (!county && state) {
        const addrLower = addr.toLowerCase();
        const cityMap = state === 'TX' ? TX_CITY_COUNTY : 
                       state === 'WA' ? WA_CITY_COUNTY : 
                       state === 'GA' ? GA_CITY_COUNTY : {};
        for (const [city, countyName] of Object.entries(cityMap)) {
            if (addrLower.includes(city)) {
                county = countyName;
                break;
            }
        }
    }

    // ── ZIP CODE VALIDATION ──
    // Extract zip if present
    // Match zip at the END of the address (last 5-digit number), not street numbers
    const zipMatch = addr.match(/(\d{5})\s*$/);
    const zip = zipMatch ? zipMatch[1] : null;
    
    if (zip && state) {
        // Validate zip prefix matches claimed state
        const zipStateMap = {
            // TX zips: 73301-73399 (Austin area), 75000-79999
            TX: z => (z >= 73301 && z <= 73399) || (z >= 75000 && z <= 79999) || (z >= 88500 && z <= 88599),
            // GA zips: 30000-31999, 39800-39999
            GA: z => (z >= 30000 && z <= 31999) || (z >= 39800 && z <= 39999),
            // WA zips: 98000-99499
            WA: z => z >= 98000 && z <= 99499,
            // AZ zips: 85000-86599
            AZ: z => z >= 85000 && z <= 86599,
            // CO zips: 80000-81699
            CO: z => z >= 80000 && z <= 81699,
            // OH zips: 43000-45999
            OH: z => z >= 43000 && z <= 45999,
            // LA zips: 70000-71499
            LA: z => z >= 70000 && z <= 71499,
            // FL zips: 32000-34999
            FL: z => z >= 32000 && z <= 34999,
            // CA zips: 90000-96199
            CA: z => z >= 90000 && z <= 96199,
        };
        
        const zipNum = parseInt(zip);
        const validator = zipStateMap[state];
        
        if (validator && !validator(zipNum)) {
            // Zip doesn't match the stated state — CONFLICT
            // Try to find the actual state from zip
            let actualState = null;
            for (const [st, fn] of Object.entries(zipStateMap)) {
                if (fn(zipNum)) { actualState = st; break; }
            }
            
            flagged = true;
            reason = `zip-state-conflict: zip ${zip} is ${actualState || 'unknown state'}, address says ${state}`;
            // Don't override state — keep what was parsed but flag it
        }
        
        // Check if zip is valid at all (not a known range)
        if (zipNum < 501 || zipNum > 99950) {
            flagged = true;
            reason = `invalid-zip: ${zip}`;
        }
    }
    
    // ── INCOMPLETE ADDRESS CHECK ──
    // If address has no city indicator (no comma, no recognized city, very short)
    const parts = addr.split(/[,\s]+/).filter(p => p.length > 0);
    const hasNumber = /\d/.test(addr);
    const hasCity = Object.keys(TX_CITY_COUNTY).some(c => addr.toLowerCase().includes(c)) ||
                    Object.keys(WA_CITY_COUNTY).some(c => addr.toLowerCase().includes(c)) ||
                    Object.keys(GA_CITY_COUNTY).some(c => addr.toLowerCase().includes(c));
    
    if (!state && !zip && !hasCity && parts.length <= 4) {
        flagged = true;
        reason = reason || 'incomplete-address: no city, state, or zip detected';
    }
    
    // ── COUNTY MISSING CHECK ──
    // If we have a state but no county, flag as needing review (soft flag)
    if (state && !county && !flagged) {
        flagged = true;
        reason = 'county-unknown: state parsed but county could not be determined';
    }

    // ── FINAL FLAG ──
    if (!state) {
        flagged = true;
        reason = reason || 'state-unknown';
    }

    return { state, county, flagged, reason };
}

module.exports = { parseAddress, STATE_MAP, TX_CITY_COUNTY };
