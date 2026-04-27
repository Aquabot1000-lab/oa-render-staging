/**
 * intake-filter.js
 * Hard gate at submission time. Wired into POST /api/intake (and similar).
 *
 * Rules:
 *   - Address required: street, city, state, zip
 *   - State must be TX (case-insensitive). Any other → out_of_tx
 *   - Zip must be 5 digits
 *   - County must resolve via county-router OR be left blank for INTAKE bucket
 *
 * Returns:
 *   { ok: true,  cleaned: {...}, decision: 'ACCEPT' }
 *   { ok: false, decision: 'OUT_OF_TX' | 'NEEDS_REVIEW', reason: string, fields: [...] }
 *
 * The route handler is responsible for either (a) refusing the submission
 * outright (decision=NEEDS_REVIEW with hard reason) or (b) recording it with
 * status='OUT_OF_TX' / 'NEEDS_REVIEW' so the state engine puts it in INTAKE.
 */
'use strict';

const COUNTY_TX = new Set([
  'fort bend','kaufman','collin','bexar','tarrant','harris','travis','dallas',
  'denton','williamson','galveston','montgomery','brazoria','hays','hidalgo',
  'el paso','nueces','cameron','bell','jefferson','smith','mclennan','ellis',
  'comal','guadalupe','rockwall','wise','parker','johnson','grayson','liberty',
]); // Common TX counties; any TX county is acceptable, this just catches typos.

function clean(s) { return (s || '').toString().trim(); }
function lc(s)    { return clean(s).toLowerCase(); }

function validateZip(zip) {
  const z = clean(zip);
  return /^\d{5}(-\d{4})?$/.test(z) ? z.slice(0, 5) : null;
}

function validateState(state) {
  const s = lc(state);
  if (!s) return { ok: false, value: null, reason: 'state required' };
  if (s === 'tx' || s === 'texas') return { ok: true, value: 'TX' };
  return { ok: false, value: s.toUpperCase(), reason: `non-TX state: ${s.toUpperCase()}` };
}

/**
 * Run the filter on a raw intake payload.
 *
 * @param {object} input  raw submission body
 * @returns {object}      { ok, decision, reason, cleaned, fields }
 */
function applyIntakeFilter(input) {
  const street = clean(input.street || input.address || input.property_address);
  const city   = clean(input.city);
  const state  = clean(input.state);
  const zip    = clean(input.zip || input.zip_code);
  const county = clean(input.county);
  const owner  = clean(input.owner_name || input.full_name || input.name);
  const email  = clean(input.email);
  const phone  = clean(input.phone || input.mobile);

  const missing = [];
  if (!street) missing.push('street');
  if (!city)   missing.push('city');
  if (!state)  missing.push('state');
  if (!zip)    missing.push('zip');
  if (!owner)  missing.push('owner_name');
  if (!email && !phone) missing.push('email_or_phone');

  if (missing.length) {
    return {
      ok:       false,
      decision: 'NEEDS_REVIEW',
      reason:   `Missing required fields: ${missing.join(', ')}`,
      fields:   missing,
      cleaned:  null,
    };
  }

  const stateCheck = validateState(state);
  if (!stateCheck.ok) {
    return {
      ok:       false,
      decision: 'OUT_OF_TX',
      reason:   stateCheck.reason,
      fields:   ['state'],
      cleaned: { street, city, state: stateCheck.value, zip, county, owner, email, phone },
    };
  }

  const cleanZip = validateZip(zip);
  if (!cleanZip) {
    return {
      ok:       false,
      decision: 'NEEDS_REVIEW',
      reason:   'Invalid zip',
      fields:   ['zip'],
      cleaned:  null,
    };
  }

  // County is optional but if provided should be TX-typical
  if (county && !COUNTY_TX.has(lc(county))) {
    return {
      ok:       true,  // accept but flag
      decision: 'NEEDS_REVIEW',
      reason:   `Unknown TX county '${county}' — manual review`,
      fields:   ['county'],
      cleaned:  { street, city, state: 'TX', zip: cleanZip, county, owner, email, phone },
    };
  }

  return {
    ok:       true,
    decision: 'ACCEPT',
    reason:   null,
    fields:   [],
    cleaned:  { street, city, state: 'TX', zip: cleanZip, county, owner, email, phone },
  };
}

module.exports = { applyIntakeFilter };
