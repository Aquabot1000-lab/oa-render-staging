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
    'san leon': 'Galveston',
    'dickinson': 'Galveston',
    'la marque': 'Galveston',
    'texas city': 'Galveston',
    'galveston': 'Galveston',
    'kemah': 'Galveston',
    'santa fe': 'Galveston',
    'friendswood': 'Galveston',
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
    'argyle': 'Denton',
    'aubrey': 'Denton',
    'valley view': 'Cooke',
    'gainesville': 'Cooke',
    'muenster': 'Cooke',
    'celina': 'Collin',
    'prosper': 'Collin',
    'melissa': 'Collin',
    'murphy': 'Collin',
    'wylie': 'Collin',
    'sachse': 'Dallas',
    'rowlett': 'Dallas',
    'rockwall': 'Rockwall',
    'heath': 'Rockwall',
    'forney': 'Kaufman',
    'terrell': 'Kaufman',
    'kaufman': 'Kaufman',
    'waxahachie': 'Ellis',
    'mansfield': 'Tarrant',
    'burleson': 'Johnson',
    'cleburne': 'Johnson',
    'weatherford': 'Parker',
    'granbury': 'Hood',
    'stephenville': 'Erath',
    'southlake': 'Tarrant',
    'keller': 'Tarrant',
    'colleyville': 'Tarrant',
    'grapevine': 'Tarrant',
    'coppell': 'Dallas',
    'trophy club': 'Denton',
    'roanoke': 'Denton',
    'haslet': 'Tarrant',
    'saginaw': 'Tarrant',
    'north richland hills': 'Tarrant',
    'hurst': 'Tarrant',
    'bedford': 'Tarrant',
    'euless': 'Tarrant',
    'texarkana': 'Bowie',
    'corsicana': 'Navarro',
    'tyler': 'Smith',
    'longview': 'Gregg',
    'nacogdoches': 'Nacogdoches',
    'lufkin': 'Angelina',
    'victoria': 'Victoria',
    'seguin': 'Guadalupe',
    'san angelo': 'Tom Green',
    'abilene': 'Taylor',
    'wichita falls': 'Wichita',
    'sherman': 'Grayson',
    'denison': 'Grayson',
    'mcallen': 'Hidalgo',
    'edinburg': 'Hidalgo',
    'mission': 'Hidalgo',
    'pharr': 'Hidalgo',
    'brownsville': 'Cameron',
    'harlingen': 'Cameron',
    'bastrop': 'Bastrop',
    'elgin': 'Bastrop',
    'manor': 'Travis',
    'liberty hill': 'Williamson',
    'leander': 'Williamson',
    'hutto': 'Williamson',
    'jarrell': 'Williamson',
    'florence': 'Williamson',
    'san benito': 'Cameron',
};

// WA city → county mapping
const WA_CITY_COUNTY = {
    'seattle': 'King',
    'burien': 'King',
    'renton': 'King',
    'kent': 'King',
    'redmond': 'King',
    'kirkland': 'King',
    'federal way': 'King',
    'auburn': 'King',
    'sammamish': 'King',
    'bothell': 'King',
    'tacoma': 'Pierce',
    'lakewood': 'Pierce',
    'puyallup': 'Pierce',
    'spokane': 'Spokane',
    'spokane valley': 'Spokane',
    'vancouver': 'Clark',
    'bellevue': 'King',
    'everett': 'Snohomish',
    'lynnwood': 'Snohomish',
    'marysville': 'Snohomish',
    'olympia': 'Thurston',
    'yakima': 'Yakima',
    'kennewick': 'Benton',
    'richland': 'Benton',
    'pasco': 'Franklin',
    'bellingham': 'Whatcom',
    'walla walla': 'Walla Walla',
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
        // If full capture didn't match (e.g. "Valley View Texas"), try the LAST word as state name
        if (!state) {
            const words = s.split(/\s+/);
            const lastWord = words[words.length - 1];
            state = STATE_MAP[lastWord] || null;
            // Also try last two words for multi-word states like "NEW YORK"
            if (!state && words.length >= 2) {
                const lastTwo = words.slice(-2).join(' ');
                state = STATE_MAP[lastTwo] || null;
            }
        }
    }

    // Pattern 2: Check for state abbreviation anywhere (e.g., "123 Main st s Tacoma wa 98444")
    if (!state) {
        const looseMatch = addr.match(/[\s,]+([A-Za-z]{2})\s+\d{5}/);
        if (looseMatch) {
            const s = looseMatch[1].toUpperCase();
            if (STATE_MAP[s]) state = STATE_MAP[s];
        }
    }

    // Pattern 3: Full state name before ZIP without comma (e.g., "456 Pine Ave Atlanta Georgia 30301")
    if (!state) {
        const stateNames = Object.keys(STATE_MAP).filter(k => k.length > 2);
        const statePattern = new RegExp('\\b(' + stateNames.join('|') + ')\\s+\\d{5}', 'i');
        const fullNameMatch = addr.match(statePattern);
        if (fullNameMatch) {
            state = STATE_MAP[fullNameMatch[1].toUpperCase()] || null;
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
    // ── ZIP-TO-COUNTY FALLBACK (TX) ──
    if (state === 'TX' && !county && zip) {
        const TX_ZIP_COUNTY = {
            // DFW Metroplex
            '75001':'Collin','75002':'Collin','75006':'Dallas','75007':'Dallas','75009':'Grayson',
            '75010':'Collin','75013':'Collin','75019':'Dallas','75023':'Collin','75024':'Collin',
            '75025':'Collin','75028':'Denton','75034':'Denton','75035':'Collin','75040':'Dallas',
            '75041':'Dallas','75042':'Dallas','75043':'Dallas','75044':'Dallas','75048':'Dallas',
            '75050':'Dallas','75051':'Dallas','75052':'Dallas','75054':'Tarrant','75056':'Denton',
            '75057':'Denton','75060':'Dallas','75061':'Dallas','75062':'Dallas','75063':'Dallas',
            '75065':'Denton','75067':'Denton','75068':'Denton','75069':'Collin','75070':'Collin',
            '75071':'Collin','75074':'Collin','75075':'Collin','75078':'Collin','75080':'Dallas',
            '75081':'Dallas','75082':'Dallas','75087':'Dallas','75088':'Dallas','75089':'Dallas',
            '75093':'Collin','75094':'Collin','75098':'Collin','75104':'Dallas','75115':'Dallas',
            '75116':'Dallas','75134':'Dallas','75137':'Dallas','75141':'Dallas','75146':'Dallas',
            '75149':'Dallas','75150':'Dallas','75154':'Dallas','75159':'Dallas','75166':'Collin',
            '75167':'Ellis','75172':'Dallas','75180':'Dallas','75181':'Dallas','75182':'Dallas',
            '75189':'Rockwall','75201':'Dallas','75202':'Dallas','75203':'Dallas','75204':'Dallas',
            '75205':'Dallas','75206':'Dallas','75207':'Dallas','75208':'Dallas','75209':'Dallas',
            '75210':'Dallas','75211':'Dallas','75212':'Dallas','75214':'Dallas','75215':'Dallas',
            '75216':'Dallas','75217':'Dallas','75218':'Dallas','75219':'Dallas','75220':'Dallas',
            '75223':'Dallas','75224':'Dallas','75225':'Dallas','75226':'Dallas','75227':'Dallas',
            '75228':'Dallas','75229':'Dallas','75230':'Dallas','75231':'Dallas','75232':'Dallas',
            '75233':'Dallas','75234':'Dallas','75235':'Dallas','75236':'Dallas','75237':'Dallas',
            '75238':'Dallas','75240':'Dallas','75243':'Dallas','75244':'Dallas','75246':'Dallas',
            '75248':'Dallas','75249':'Dallas','75251':'Dallas','75252':'Dallas','75254':'Dallas',
            '75287':'Dallas',
            // Denton County ZIPs
            '76201':'Denton','76205':'Denton','76207':'Denton','76208':'Denton','76209':'Denton',
            '76210':'Denton','76226':'Denton','76227':'Denton','76247':'Denton','76249':'Denton',
            '76258':'Denton','76259':'Denton','76266':'Denton',
            // Tarrant County
            '76001':'Tarrant','76002':'Tarrant','76006':'Tarrant','76008':'Parker','76009':'Johnson',
            '76010':'Tarrant','76011':'Tarrant','76012':'Tarrant','76013':'Tarrant','76014':'Tarrant',
            '76015':'Tarrant','76016':'Tarrant','76017':'Tarrant','76018':'Tarrant','76019':'Tarrant',
            '76020':'Tarrant','76021':'Tarrant','76022':'Tarrant','76028':'Johnson','76031':'Johnson',
            '76033':'Johnson','76034':'Tarrant','76036':'Tarrant','76039':'Tarrant','76040':'Tarrant',
            '76044':'Johnson','76048':'Hood','76049':'Hood','76051':'Tarrant','76052':'Tarrant',
            '76053':'Tarrant','76054':'Tarrant','76058':'Johnson','76059':'Johnson','76060':'Tarrant',
            '76063':'Tarrant','76092':'Tarrant','76102':'Tarrant','76103':'Tarrant','76104':'Tarrant',
            '76105':'Tarrant','76106':'Tarrant','76107':'Tarrant','76108':'Tarrant','76109':'Tarrant',
            '76110':'Tarrant','76111':'Tarrant','76112':'Tarrant','76114':'Tarrant','76116':'Tarrant',
            '76117':'Tarrant','76118':'Tarrant','76119':'Tarrant','76120':'Tarrant','76123':'Tarrant',
            '76126':'Tarrant','76127':'Tarrant','76129':'Tarrant','76131':'Tarrant','76132':'Tarrant',
            '76133':'Tarrant','76134':'Tarrant','76135':'Tarrant','76137':'Tarrant','76140':'Tarrant',
            '76148':'Tarrant','76155':'Tarrant','76164':'Tarrant','76177':'Tarrant','76179':'Tarrant',
            '76180':'Tarrant','76182':'Tarrant',
            // San Antonio / Bexar
            '78201':'Bexar','78202':'Bexar','78203':'Bexar','78204':'Bexar','78205':'Bexar',
            '78206':'Bexar','78207':'Bexar','78208':'Bexar','78209':'Bexar','78210':'Bexar',
            '78211':'Bexar','78212':'Bexar','78213':'Bexar','78214':'Bexar','78215':'Bexar',
            '78216':'Bexar','78217':'Bexar','78218':'Bexar','78219':'Bexar','78220':'Bexar',
            '78221':'Bexar','78222':'Bexar','78223':'Bexar','78224':'Bexar','78225':'Bexar',
            '78226':'Bexar','78227':'Bexar','78228':'Bexar','78229':'Bexar','78230':'Bexar',
            '78231':'Bexar','78232':'Bexar','78233':'Bexar','78234':'Bexar','78235':'Bexar',
            '78236':'Bexar','78237':'Bexar','78238':'Bexar','78239':'Bexar','78240':'Bexar',
            '78242':'Bexar','78243':'Bexar','78244':'Bexar','78245':'Bexar','78247':'Bexar',
            '78248':'Bexar','78249':'Bexar','78250':'Bexar','78251':'Bexar','78252':'Bexar',
            '78253':'Bexar','78254':'Bexar','78255':'Bexar','78256':'Bexar','78257':'Bexar',
            '78258':'Bexar','78259':'Bexar','78260':'Bexar','78261':'Bexar','78263':'Bexar',
            '78264':'Bexar','78266':'Bexar',
            // Comal
            '78130':'Comal','78132':'Comal','78133':'Comal','78163':'Comal',
            // Guadalupe
            '78108':'Guadalupe','78109':'Guadalupe','78148':'Guadalupe','78150':'Guadalupe',
            '78154':'Guadalupe','78155':'Guadalupe',
            // Houston / Harris
            '77001':'Harris','77002':'Harris','77003':'Harris','77004':'Harris','77005':'Harris',
            '77006':'Harris','77007':'Harris','77008':'Harris','77009':'Harris','77010':'Harris',
            '77011':'Harris','77012':'Harris','77013':'Harris','77014':'Harris','77015':'Harris',
            '77016':'Harris','77017':'Harris','77018':'Harris','77019':'Harris','77020':'Harris',
            '77021':'Harris','77022':'Harris','77023':'Harris','77024':'Harris','77025':'Harris',
            '77026':'Harris','77027':'Harris','77028':'Harris','77029':'Harris','77030':'Harris',
            '77031':'Harris','77033':'Harris','77034':'Harris','77035':'Harris','77036':'Harris',
            '77037':'Harris','77038':'Harris','77039':'Harris','77040':'Harris','77041':'Harris',
            '77042':'Harris','77043':'Harris','77044':'Harris','77045':'Harris','77046':'Harris',
            '77047':'Harris','77048':'Harris','77049':'Harris','77050':'Harris','77051':'Harris',
            '77053':'Harris','77054':'Harris','77055':'Harris','77056':'Harris','77057':'Harris',
            '77058':'Harris','77059':'Harris','77060':'Harris','77061':'Harris','77062':'Harris',
            '77063':'Harris','77064':'Harris','77065':'Harris','77066':'Harris','77067':'Harris',
            '77068':'Harris','77069':'Harris','77070':'Harris','77071':'Harris','77072':'Harris',
            '77073':'Harris','77074':'Harris','77075':'Harris','77076':'Harris','77077':'Harris',
            '77078':'Harris','77079':'Harris','77080':'Harris','77081':'Harris','77082':'Harris',
            '77083':'Harris','77084':'Harris','77085':'Harris','77086':'Harris','77087':'Harris',
            '77088':'Harris','77089':'Harris','77090':'Harris','77091':'Harris','77092':'Harris',
            '77093':'Harris','77094':'Harris','77095':'Harris','77096':'Harris',
            // Fort Bend
            '77406':'Fort Bend','77407':'Fort Bend','77441':'Fort Bend','77459':'Fort Bend',
            '77461':'Fort Bend','77469':'Fort Bend','77471':'Fort Bend','77478':'Fort Bend',
            '77479':'Fort Bend','77494':'Fort Bend','77498':'Fort Bend','77545':'Fort Bend',
            // Galveston County
            '77510':'Galveston','77511':'Galveston','77517':'Galveston','77518':'Galveston',
            '77539':'Galveston','77546':'Galveston','77550':'Galveston','77551':'Galveston',
            '77554':'Galveston','77555':'Galveston','77563':'Galveston','77565':'Galveston',
            '77568':'Galveston','77573':'Galveston','77574':'Galveston','77590':'Galveston',
            '77591':'Galveston','77598':'Galveston',
            // Bowie (Texarkana)
            '75501':'Bowie','75503':'Bowie','75504':'Bowie','75507':'Bowie',
            // Austin / Travis / Williamson / Hays
            '78701':'Travis','78702':'Travis','78703':'Travis','78704':'Travis','78705':'Travis',
            '78717':'Williamson','78719':'Travis','78721':'Travis','78722':'Travis','78723':'Travis',
            '78724':'Travis','78725':'Travis','78726':'Williamson','78727':'Travis','78728':'Williamson',
            '78729':'Williamson','78730':'Travis','78731':'Travis','78732':'Travis','78733':'Travis',
            '78734':'Travis','78735':'Travis','78736':'Travis','78737':'Hays','78738':'Travis',
            '78739':'Travis','78741':'Travis','78744':'Travis','78745':'Travis','78746':'Travis',
            '78747':'Travis','78748':'Travis','78749':'Travis','78750':'Travis','78751':'Travis',
            '78752':'Travis','78753':'Travis','78754':'Travis','78756':'Travis','78757':'Travis',
            '78758':'Travis','78759':'Travis',
            '78613':'Williamson','78626':'Williamson','78628':'Williamson','78634':'Williamson',
            '78641':'Williamson','78642':'Williamson','78660':'Williamson','78664':'Williamson',
            '78665':'Williamson','78681':'Williamson',
            '78610':'Hays','78640':'Hays','78666':'Hays',
        };
        county = TX_ZIP_COUNTY[zip] || null;
        if (county) {
            console.log(`[AddressParser] ZIP fallback: ${zip} → ${county} County`);
        }
    }

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
