// DRY RUN — reads only, no writes to submissions
const { Client } = require('pg');
const DB = 'postgresql://postgres.ylxreuqvofgbpsatfsvr:h1AVVY1oXH9kJcwz@aws-0-us-west-2.pooler.supabase.com:5432/postgres';

// ── NORMALIZATION ──
const SUFFIX_MAP = {
  'road': 'RD', 'rd': 'RD', 'street': 'ST', 'str': 'ST', 'st': 'ST',
  'drive': 'DR', 'dr': 'DR', 'lane': 'LN', 'ln': 'LN',
  'place': 'PL', 'pl': 'PL', 'court': 'CT', 'ct': 'CT',
  'circle': 'CIR', 'cir': 'CIR', 'boulevard': 'BLVD', 'blvd': 'BLVD',
  'avenue': 'AVE', 'ave': 'AVE', 'way': 'WAY', 'trail': 'TRL', 'trl': 'TRL',
  'parkway': 'PKWY', 'pkwy': 'PKWY', 'highway': 'HWY', 'hwy': 'HWY',
  'terrace': 'TER', 'ter': 'TER', 'loop': 'LOOP',
};

function normalizeStreet(addr) {
  if (!addr) return '';
  // Take everything before first comma
  let s = addr.split(',')[0];
  // Remove unit/apt
  s = s.replace(/\b(apt|unit|ste|suite|#)\s*\S*/gi, '');
  // Remove periods
  s = s.replace(/\./g, '');
  // Uppercase and compress whitespace
  s = s.toUpperCase().replace(/\s+/g, ' ').trim();
  // Normalize suffixes
  const words = s.split(' ');
  const normalized = words.map(w => SUFFIX_MAP[w.toLowerCase()] || w);
  return normalized.join(' ');
}

function extractStreetNum(addr) {
  if (!addr) return '';
  const clean = addr.replace(/\r?\n/g, ' ').trim();
  return clean.split(/\s+/)[0];
}

async function run() {
  const client = new Client({ connectionString: DB, statement_timeout: 30000 });
  await client.connect();

  // Get the 22 TX records needing enrichment (non-test, non-simple-form)
  const { rows: cases } = await client.query(`
    SELECT case_id, property_address, county, state, sqft, bedrooms, bathrooms, year_built
    FROM submissions
    WHERE state = 'TX'
      AND (sqft IS NULL OR sqft <= 0 OR bedrooms IS NULL OR bedrooms <= 0 OR bathrooms IS NULL OR bathrooms <= 0 OR year_built IS NULL OR year_built <= 0)
      AND owner_name NOT IN ('Simple Form Lead', 'Test Flow Lead')
      AND case_id NOT LIKE 'BM-%'
      AND (source IS NULL OR source != 'simple-form')
      AND (status IS NULL OR status NOT IN ('Deleted', 'Blocked - Bad Data'))
    ORDER BY case_id
  `);

  console.log(`\n=== DRY RUN ENRICHMENT: ${cases.length} cases ===\n`);
  console.log('Case     | Address                               | Match? | Confidence | sqft | beds | baths | year | Source');
  console.log('---------|---------------------------------------|--------|------------|------|------|-------|------|-------');

  let matched = 0, needsReview = 0, noMatch = 0;

  for (const c of cases) {
    const streetKey = normalizeStreet(c.property_address);
    const streetNum = extractStreetNum(c.property_address);
    const county = c.county;

    let results = [];
    let method = '';
    let confidence = '';

    // Method 1: street_key + county exact match
    if (county) {
      const { rows } = await client.query(
        "SELECT sqft, beds, baths, year_built, property_address, county FROM county_properties WHERE county = $1 AND street_key = $2",
        [county, streetKey]
      );
      if (rows.length > 0) {
        results = rows;
        method = 'key+county';
      }
    }

    // Method 2: street_num + first word of street + county
    if (results.length === 0 && county && streetNum) {
      const streetWords = streetKey.split(' ');
      if (streetWords.length >= 2) {
        const pattern = streetNum + ' ' + streetWords[1] + '%';
        const { rows } = await client.query(
          "SELECT sqft, beds, baths, year_built, property_address, county FROM county_properties WHERE county = $1 AND street_num = $2 AND street_key LIKE $3",
          [county, streetNum, pattern]
        );
        if (rows.length > 0) {
          results = rows;
          method = 'num+word+county';
        }
      }
    }

    // Method 3: street_num + first two words (no county)
    if (results.length === 0 && streetNum) {
      const streetWords = streetKey.split(' ');
      if (streetWords.length >= 3) {
        const pattern = streetNum + ' ' + streetWords[1] + ' ' + streetWords[2] + '%';
        const { rows } = await client.query(
          "SELECT sqft, beds, baths, year_built, property_address, county FROM county_properties WHERE street_num = $1 AND street_key LIKE $2 LIMIT 5",
          [streetNum, pattern]
        );
        if (rows.length > 0) {
          results = rows;
          method = 'num+2words';
        }
      }
    }

    // Evaluate results
    let matchStr, sqft = '', beds = '', baths = '', year = '', source = '';

    if (results.length === 0) {
      matchStr = 'NO';
      confidence = '-';
      source = '-';
      noMatch++;
    } else if (results.length === 1) {
      const r = results[0];
      matchStr = 'YES';
      confidence = method === 'key+county' ? 'HIGH' : 'MEDIUM';
      sqft = r.sqft || '';
      beds = r.beds || '';
      baths = r.baths || '';
      year = r.year_built || '';
      source = method;
      matched++;

      // Cross-validation: check county matches
      if (r.county && county && r.county.toLowerCase() !== county.toLowerCase()) {
        confidence = 'CROSS_COUNTY';
        matchStr = 'REVIEW';
        matched--;
        needsReview++;
      }
    } else {
      // Multiple matches — check if they agree
      const sqfts = [...new Set(results.filter(r => r.sqft).map(r => r.sqft))];
      const years = [...new Set(results.filter(r => r.year_built).map(r => r.year_built))];
      
      if (sqfts.length <= 1 && years.length <= 1) {
        // All agree
        const r = results[0];
        matchStr = 'YES';
        confidence = 'MEDIUM';
        sqft = r.sqft || '';
        beds = r.beds || '';
        baths = r.baths || '';
        year = r.year_built || '';
        source = method + '(' + results.length + ')';
        matched++;
      } else {
        matchStr = 'REVIEW';
        confidence = 'MULTI(' + results.length + ')';
        const r = results[0];
        sqft = r.sqft ? r.sqft + '?' : '';
        beds = r.beds ? r.beds + '?' : '';
        baths = r.baths ? r.baths + '?' : '';
        year = r.year_built ? r.year_built + '?' : '';
        source = method + '(' + results.length + ')';
        needsReview++;
      }
    }

    // Show which fields are already populated vs need enrichment
    const needsFields = [];
    if (!c.sqft || c.sqft <= 0) needsFields.push('sqft');
    if (!c.bedrooms || c.bedrooms <= 0) needsFields.push('beds');
    if (!c.bathrooms || c.bathrooms <= 0) needsFields.push('baths');
    if (!c.year_built || c.year_built <= 0) needsFields.push('year');

    const addrShort = (c.property_address || '').substring(0, 37).padEnd(37);
    console.log(
      `${c.case_id.padEnd(9)}| ${addrShort} | ${matchStr.padEnd(6)} | ${String(confidence).padEnd(10)} | ${String(sqft).padEnd(4)} | ${String(beds).padEnd(4)} | ${String(baths).padEnd(5)} | ${String(year).padEnd(4)} | ${source}`
    );
  }

  console.log('---------|---------------------------------------|--------|------------|------|------|-------|------|-------');
  console.log(`\nSUMMARY: ${matched} matched, ${needsReview} needs review, ${noMatch} no match`);
  console.log(`Recovery rate: ${Math.round(matched / cases.length * 100)}% auto-fill, ${Math.round((matched + needsReview) / cases.length * 100)}% total recoverable`);

  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
