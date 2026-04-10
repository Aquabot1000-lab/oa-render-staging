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

    // Flag logic
    if (!state) {
        flagged = true;
        reason = 'state-unknown';
    }

    return { state, county, flagged, reason };
}

module.exports = { parseAddress, STATE_MAP, TX_CITY_COUNTY };
