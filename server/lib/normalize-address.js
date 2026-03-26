'use strict';

// ── Street suffix map ──
const SUFFIXES = {
  street: 'st', str: 'st', strt: 'st',
  avenue: 'ave', avn: 'ave', avnue: 'ave', av: 'ave',
  drive: 'dr', drv: 'dr', driv: 'dr',
  boulevard: 'blvd', boul: 'blvd', boulv: 'blvd',
  road: 'rd',
  lane: 'ln',
  court: 'ct', crt: 'ct',
  circle: 'cir', crcl: 'cir', crcle: 'cir',
  place: 'pl',
  terrace: 'ter', terr: 'ter', trce: 'ter',
  trail: 'trl', trls: 'trl',
  way: 'way',
  parkway: 'pkwy', pkway: 'pkwy', pky: 'pkwy',
  highway: 'hwy', hiway: 'hwy', hiwy: 'hwy',
  expressway: 'expy', expw: 'expy',
  brook: 'brk', brks: 'brk',
  crossing: 'xing', crssng: 'xing',
  cove: 'cv',
  point: 'pt', pnt: 'pt',
  ridge: 'rdg', rdge: 'rdg',
  valley: 'vly', vlly: 'vly',
  view: 'vw',
  village: 'vlg', villg: 'vlg', villag: 'vlg',
  creek: 'crk',
  estate: 'est', estates: 'ests',
  fork: 'frk', forks: 'frks',
  garden: 'gdn', gardens: 'gdns', gardn: 'gdn',
  grove: 'grv',
  harbor: 'hbr', harbr: 'hbr',
  heights: 'hts', ht: 'hts',
  hill: 'hl', hills: 'hls',
  hollow: 'holw', hllw: 'holw',
  island: 'is', islands: 'iss',
  junction: 'jct', jction: 'jct', jctn: 'jct',
  lake: 'lk', lakes: 'lks',
  landing: 'lndg', lndng: 'lndg',
  loop: 'loop', loops: 'loop',
  manor: 'mnr', manors: 'mnrs',
  meadow: 'mdw', meadows: 'mdws',
  mission: 'msn', missn: 'msn',
  mount: 'mt', mountain: 'mtn',
  orchard: 'orch', orchrd: 'orch',
  pass: 'pass',
  path: 'path', paths: 'path',
  pike: 'pike', pikes: 'pike',
  plain: 'pln', plains: 'plns',
  plaza: 'plz', plza: 'plz',
  ranch: 'rnch', ranches: 'rnch',
  run: 'run',
  shore: 'shr', shores: 'shrs',
  spring: 'spg', springs: 'spgs',
  square: 'sq', sqr: 'sq', sqre: 'sq',
  station: 'sta', statn: 'sta',
  summit: 'smt', sumit: 'smt', sumitt: 'smt',
  trace: 'trce',
  track: 'trak', trk: 'trak',
  tunnel: 'tunl', tunnl: 'tunl', tunls: 'tunl',
  turnpike: 'tpke', trnpk: 'tpke',
  walk: 'walk', walks: 'walk',
  wells: 'wls', well: 'wl',
};

// ── Directional map ──
const DIRECTIONALS = {
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw',
};

// ── Unit designators ──
const UNITS = {
  apartment: 'apt', suite: 'ste', unit: 'unit', room: 'rm',
  building: 'bldg', floor: 'fl', department: 'dept',
};

// ── State names → 2-letter codes ──
const STATES = {
  alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar',
  california: 'ca', colorado: 'co', connecticut: 'ct', delaware: 'de',
  florida: 'fl', georgia: 'ga', hawaii: 'hi', idaho: 'id',
  illinois: 'il', indiana: 'in', iowa: 'ia', kansas: 'ks',
  kentucky: 'ky', louisiana: 'la', maine: 'me', maryland: 'md',
  massachusetts: 'ma', michigan: 'mi', minnesota: 'mn', mississippi: 'ms',
  missouri: 'mo', montana: 'mt', nebraska: 'ne', nevada: 'nv',
  'new hampshire': 'nh', 'new jersey': 'nj', 'new mexico': 'nm', 'new york': 'ny',
  'north carolina': 'nc', 'north dakota': 'nd', ohio: 'oh', oklahoma: 'ok',
  oregon: 'or', pennsylvania: 'pa', 'rhode island': 'ri', 'south carolina': 'sc',
  'south dakota': 'sd', tennessee: 'tn', texas: 'tx', utah: 'ut',
  vermont: 'vt', virginia: 'va', washington: 'wa', 'west virginia': 'wv',
  wisconsin: 'wi', wyoming: 'wy', 'district of columbia': 'dc',
};

// Valid 2-letter state codes for detection
const STATE_CODES = new Set(Object.values(STATES));

/**
 * Full address normalization — lowercase, strip punctuation,
 * normalize suffixes/directionals/units/states, strip zips.
 */
function normalizeAddress(addr) {
  if (!addr || typeof addr !== 'string') return '';

  let s = addr.toLowerCase().trim();

  // Strip periods, commas, hash-as-unit-prefix
  s = s.replace(/[.,]/g, '');
  s = s.replace(/#\s*/g, 'apt ');

  // Separate zip from state if glued: "TX78641" → "TX 78641"
  s = s.replace(/([a-z]{2})(\d{5})/gi, '$1 $2');

  // Strip zip codes (5-digit or 5+4)
  s = s.replace(/\b\d{5}(-\d{4})?\b/g, '');

  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();

  // Normalize multi-word state names first (before splitting)
  for (const [full, code] of Object.entries(STATES)) {
    if (full.includes(' ') && s.includes(full)) {
      s = s.replace(new RegExp('\\b' + full + '\\b', 'g'), code);
    }
  }

  // Split into words for token-level normalization
  let words = s.split(' ');

  words = words.map(w => {
    // State names (single word)
    if (STATES[w]) return STATES[w];
    // Street suffixes
    if (SUFFIXES[w]) return SUFFIXES[w];
    // Directionals (full words)
    if (DIRECTIONALS[w]) return DIRECTIONALS[w];
    // Unit designators
    if (UNITS[w]) return UNITS[w];
    return w;
  });

  // Collapse adjacent single-letter directionals: "n e" → "ne", "s w" → "sw"
  const collapsed = [];
  for (let i = 0; i < words.length; i++) {
    const cur = words[i];
    const next = words[i + 1];
    if (cur.length === 1 && /^[nsew]$/.test(cur) && next && next.length === 1 && /^[nsew]$/.test(next)) {
      const combo = cur + next;
      if (['ne', 'nw', 'se', 'sw'].includes(combo)) {
        collapsed.push(combo);
        i++; // skip next
        continue;
      }
    }
    collapsed.push(cur);
  }

  return collapsed.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extract just the street portion (strip city/state/zip from end).
 * Heuristic: remove trailing state code + anything after, then city.
 */
function normalizeStreet(addr) {
  const full = normalizeAddress(addr);
  if (!full) return '';

  const words = full.split(' ');

  // Find last state code and strip from there
  for (let i = words.length - 1; i >= 2; i--) {
    if (STATE_CODES.has(words[i])) {
      // Everything before the word before the state code might be city
      // Try to keep just the street: strip state + possible city word(s)
      // Heuristic: street number is always first, so find where numbers/suffixes end
      return words.slice(0, i).join(' ').trim();
    }
  }

  return full;
}

/**
 * Extract street number from normalized address.
 */
function streetNumber(normalized) {
  const m = normalized.match(/^(\d+)/);
  return m ? m[1] : '';
}

/**
 * Check if two addresses refer to the same property.
 */
function addressesMatch(a, b) {
  if (!a || !b) return false;

  const na = normalizeAddress(a);
  const nb = normalizeAddress(b);

  // Exact full match
  if (na === nb) return true;

  // Street-only match (handles one having city/state, other not)
  const sa = normalizeStreet(a);
  const sb = normalizeStreet(b);
  if (sa && sb && sa === sb) return true;

  // Street number + first few street words match
  const numA = streetNumber(na);
  const numB = streetNumber(nb);
  if (!numA || !numB || numA !== numB) return false;

  // Same street number — compare street name words (skip number)
  const wordsA = na.split(' ').slice(1);
  const wordsB = nb.split(' ').slice(1);

  // Find common street name portion (ignoring city/state at end)
  const streetWordsA = stripCityState(wordsA);
  const streetWordsB = stripCityState(wordsB);

  if (streetWordsA.length > 0 && streetWordsB.length > 0) {
    return streetWordsA.join(' ') === streetWordsB.join(' ');
  }

  return false;
}

/**
 * Strip trailing city + state tokens from word array.
 */
function stripCityState(words) {
  const result = [...words];

  // If last word is a state code, remove it + preceding city word(s)
  if (result.length >= 2 && STATE_CODES.has(result[result.length - 1])) {
    result.pop(); // remove state
    // Remove 1-3 city words (most cities are 1-2 words)
    // Heuristic: stop when we hit a known suffix or directional
    const allSuffixes = new Set([...Object.values(SUFFIXES), ...Object.keys(SUFFIXES)]);
    const allDirs = new Set([...Object.values(DIRECTIONALS), 'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);
    let removed = 0;
    while (result.length > 1 && removed < 3) {
      const last = result[result.length - 1];
      if (allSuffixes.has(last) || allDirs.has(last) || /^\d/.test(last)) break;
      result.pop();
      removed++;
    }
  }

  return result;
}

module.exports = { normalizeAddress, normalizeStreet, addressesMatch };
