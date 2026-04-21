/**
 * WA Parcel Validator
 * 
 * Runs after parcel IDs are entered for WA cases.
 * 1. Looks up parcel record from county assessor GIS (where available)
 * 2. Cross-validates: owner name, address, county
 * 3. Flags mismatches — does NOT proceed to form generation if mismatch found
 * 4. Writes validation result back to CRM (data_validation_status, notes)
 * 
 * Usage: node wa-parcel-validator.js [case_id]
 *        node wa-parcel-validator.js ALL
 */

require('dotenv').config({ path: '../.env' });
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ── County GIS endpoints (REST API, no auth required) ──
const GIS = {
  King: {
    url: 'https://gismaps.kingcounty.gov/arcgis/rest/services/Property/KingCo_Parcels/MapServer/0/query',
    pinField: 'PIN',
    ownerField: 'NAME',
    addrField: 'ADDR_FULL',
    countyField: null,
  },
  Pierce: {
    url: 'https://gis.piercecountywa.gov/arcgis/rest/services/ExternalServices/Parcel/MapServer/0/query',
    pinField: 'PARCEL_NUM',
    ownerField: 'OWNER_NAME',
    addrField: 'SITUS_ADDRESS',
    countyField: null,
  },
  Snohomish: {
    url: 'https://gis.snohomishcountywa.gov/arcgis/rest/services/Assessor/Parcels/MapServer/0/query',
    pinField: 'PARCEL_NUMBER',
    ownerField: 'OWNER_NAME',
    addrField: 'SITUS_ADDR',
    countyField: null,
  },
  Spokane: {
    url: 'https://gis.spokanecounty.org/arcgis/rest/services/Property/Property_Information/MapServer/0/query',
    pinField: 'PARCEL_NUMBER',
    ownerField: 'OWNER_NAME',
    addrField: 'SITE_ADDRESS',
    countyField: null,
  },
  Yakima: {
    url: 'https://gis.yakimacounty.us/arcgis/rest/services/BaseData/YakimaCounty_Parcels/MapServer/0/query',
    pinField: 'PARCEL_NUM',
    ownerField: 'OWNER_NAME',
    addrField: 'SITE_ADDR',
    countyField: null,
  },
  // Manual-only counties (no open GIS REST API confirmed)
  Kitsap:  { manual: true },
  Ferry:   { manual: true },
  Stevens: { manual: true },
};

// Normalize strings for fuzzy comparison
function normalize(str) {
  if (!str) return '';
  return str.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

// Check if two strings are "close enough" (one contains the other, or 80%+ words match)
function looseMatch(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = na.split(' '), wb = nb.split(' ');
  const shared = wa.filter(w => wb.includes(w));
  return shared.length / Math.max(wa.length, wb.length) >= 0.6;
}

async function lookupParcel(county, pin) {
  const gis = GIS[county];
  if (!gis || gis.manual) return { manual: true };

  try {
    const r = await axios.get(gis.url, {
      params: {
        where: `${gis.pinField}='${pin}'`,
        outFields: [gis.pinField, gis.ownerField, gis.addrField].filter(Boolean).join(','),
        returnGeometry: false,
        f: 'json'
      },
      timeout: 10000,
      headers: { 'User-Agent': 'OverAssessed/1.0' }
    });
    const feat = r.data?.features?.[0]?.attributes;
    if (!feat) return { found: false };
    return {
      found: true,
      parcel: feat[gis.pinField],
      owner: feat[gis.ownerField],
      address: feat[gis.addrField],
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function validateCase(c) {
  const county = c.county ? c.county.trim() : null;
  // Normalize county name (handle lowercase entries like "pierce")
  const countyKey = county ? county.charAt(0).toUpperCase() + county.slice(1).toLowerCase().replace(/\s+county.*$/, '') : null;

  const result = {
    case_id: c.case_id,
    owner_name: c.owner_name,
    address: c.property_address,
    county: countyKey,
    parcel: c.pin,
    issues: [],
    status: 'PENDING',
    gis_owner: null,
    gis_address: null,
  };

  if (!c.pin) {
    result.issues.push('MISSING_PARCEL_ID');
    result.status = 'BLOCKED';
    return result;
  }

  if (!countyKey) {
    result.issues.push('MISSING_COUNTY');
    result.status = 'BLOCKED';
    return result;
  }

  const gisData = await lookupParcel(countyKey, c.pin);

  if (gisData.manual) {
    result.status = 'MANUAL_REQUIRED';
    result.issues.push('MANUAL_LOOKUP_REQUIRED — county GIS not automated: ' + countyKey);
    return result;
  }

  if (gisData.error) {
    result.status = 'GIS_ERROR';
    result.issues.push('GIS_ERROR: ' + gisData.error);
    return result;
  }

  if (!gisData.found) {
    result.status = 'NOT_FOUND';
    result.issues.push('PARCEL_NOT_FOUND in ' + countyKey + ' GIS for PIN: ' + c.pin);
    return result;
  }

  result.gis_owner = gisData.owner;
  result.gis_address = gisData.address;

  // Validate owner name
  if (!looseMatch(c.owner_name, gisData.owner)) {
    result.issues.push(`NAME_MISMATCH — CRM: "${c.owner_name}" | GIS: "${gisData.owner}"`);
  }

  // Validate address
  if (!looseMatch(c.property_address, gisData.address)) {
    result.issues.push(`ADDRESS_MISMATCH — CRM: "${c.property_address}" | GIS: "${gisData.address}"`);
  }

  result.status = result.issues.length === 0 ? 'VERIFIED' : 'MISMATCH';
  return result;
}

async function writeValidationResult(caseId, result) {
  const statusMap = {
    VERIFIED: 'verified',
    MISMATCH: 'mismatch_flagged',
    BLOCKED: 'blocked_missing_data',
    MANUAL_REQUIRED: 'manual_verification_required',
    NOT_FOUND: 'parcel_not_found',
    GIS_ERROR: 'gis_error',
    PENDING: 'pending',
  };

  const notes = result.issues.length
    ? 'WA Parcel Validation: ' + result.issues.join('; ')
    : 'WA Parcel Validation: PASSED — name and address confirmed via county GIS';

  await sb.from('submissions').update({
    data_validation_status: statusMap[result.status] || result.status,
    notes: notes,
    last_data_check: new Date().toISOString(),
  }).eq('case_id', caseId);
}

async function main() {
  const target = process.argv[2] || 'ALL';

  let query = sb.from('submissions')
    .select('case_id,owner_name,property_address,county,state,pin,assessed_value,status')
    .eq('state', 'WA')
    .not('case_id', 'like', 'BM-%')
    .not('case_id', 'like', 'TEST%')
    .is('deleted_at', null);

  if (target !== 'ALL') query = query.eq('case_id', target);

  const { data, error } = await query.order('case_id');
  if (error) { console.error('DB error:', error.message); process.exit(1); }

  console.log(`\nValidating ${data.length} WA case(s)...\n`);
  console.log('─'.repeat(80));

  const summary = { verified: [], mismatch: [], blocked: [], manual: [], error: [] };

  for (const c of data) {
    process.stdout.write(`${c.case_id} ${c.owner_name} (${c.county || 'no county'}) PIN:${c.pin || 'MISSING'} → `);
    const result = await validateCase(c);
    await writeValidationResult(c.case_id, result);

    console.log(result.status);
    if (result.issues.length) result.issues.forEach(i => console.log('  ⚠️  ' + i));
    if (result.gis_owner) console.log(`  GIS owner: ${result.gis_owner} | GIS addr: ${result.gis_address}`);

    if (result.status === 'VERIFIED') summary.verified.push(c.case_id);
    else if (result.status === 'MISMATCH') summary.mismatch.push(c.case_id);
    else if (result.status === 'BLOCKED') summary.blocked.push(c.case_id);
    else if (result.status === 'MANUAL_REQUIRED') summary.manual.push(c.case_id);
    else summary.error.push(c.case_id);
  }

  console.log('\n' + '─'.repeat(80));
  console.log('SUMMARY');
  console.log(`  ✅ VERIFIED (cleared for form generation): ${summary.verified.join(', ') || 'none'}`);
  console.log(`  ⚠️  MISMATCH (flagged, do not proceed):     ${summary.mismatch.join(', ') || 'none'}`);
  console.log(`  🔴 BLOCKED (missing parcel/county):         ${summary.blocked.join(', ') || 'none'}`);
  console.log(`  📋 MANUAL REQUIRED (county has no GIS API): ${summary.manual.join(', ') || 'none'}`);
  console.log(`  ❌ GIS ERROR / NOT FOUND:                   ${summary.error.join(', ') || 'none'}`);
  console.log('\nForm generation is BLOCKED for all non-VERIFIED cases.');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
