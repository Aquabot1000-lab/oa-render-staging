'use strict';

// ── Phone normalization ──
function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return { valid: false, formatted: '', cleaned: '', error: 'Phone number is required' };

  const cleaned = phone.replace(/\D/g, '');
  let digits = cleaned;

  // Strip leading country code 1
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);

  if (digits.length !== 10) {
    return { valid: false, formatted: phone, cleaned: digits, error: 'Phone number must be 10 digits' };
  }

  // Reject area codes starting with 0 or 1
  if (digits[0] === '0' || digits[0] === '1') {
    return { valid: false, formatted: phone, cleaned: digits, error: 'Invalid area code' };
  }

  // Reject 555-01xx test range
  if (digits.slice(3, 7) === '0100' || (digits.slice(3, 6) === '555' && digits.slice(6, 8) === '01')) {
    return { valid: false, formatted: phone, cleaned: digits, error: 'Invalid phone number' };
  }

  const formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return { valid: true, formatted, cleaned: digits, error: null };
}

// ── Email normalization ──
const DOMAIN_TYPOS = {
  'gnail.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmial.com': 'gmail.com',
  'gmail.co': 'gmail.com', 'gamil.com': 'gmail.com', 'gmaill.com': 'gmail.com',
  'gmail.cm': 'gmail.com', 'gmail.om': 'gmail.com', 'gmai.com': 'gmail.com',
  'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.co': 'yahoo.com',
  'yhoo.com': 'yahoo.com', 'yhaoo.com': 'yahoo.com', 'yahoo.cm': 'yahoo.com',
  'hotmal.com': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'hotamil.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com', 'hotmail.cm': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlool.com': 'outlook.com',
  'outlook.co': 'outlook.com', 'outlook.cm': 'outlook.com',
  'icloud.co': 'icloud.com', 'icloud.cm': 'icloud.com', 'icoud.com': 'icloud.com',
  'aol.co': 'aol.com', 'aol.cm': 'aol.com',
  'protonmail.co': 'protonmail.com', 'protonmail.cm': 'protonmail.com',
};

// TLD typos
const TLD_TYPOS = {
  '.con': '.com', '.cmo': '.com', '.vom': '.com', '.ocm': '.com',
  '.cm': '.com', '.co': '.com', '.om': '.com',
  '.ent': '.net', '.nte': '.net',
  '.ogr': '.org',
};

function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return { valid: false, corrected: '', suggestions: [], error: 'Email is required' };

  let corrected = email.trim().toLowerCase();
  const suggestions = [];

  // Basic format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(corrected)) {
    return { valid: false, corrected, suggestions: [], error: 'Invalid email format' };
  }

  const [local, domain] = corrected.split('@');
  let fixedDomain = domain;

  // Check full domain typos first
  if (DOMAIN_TYPOS[fixedDomain]) {
    suggestions.push(corrected);
    fixedDomain = DOMAIN_TYPOS[fixedDomain];
  } else {
    // Check TLD typos
    for (const [typo, fix] of Object.entries(TLD_TYPOS)) {
      if (fixedDomain.endsWith(typo) && !fixedDomain.endsWith(fix)) {
        suggestions.push(corrected);
        fixedDomain = fixedDomain.slice(0, -typo.length) + fix;
        break;
      }
    }
  }

  corrected = `${local}@${fixedDomain}`;
  return { valid: true, corrected, suggestions, error: null };
}

// ── Name normalization ──
const TEST_NAMES = new Set(['test', 'asdf', 'xxx', 'yyy', 'zzz', 'aaa', 'bbb', 'none', 'na', 'n/a', 'john doe', 'jane doe', 'foo bar', 'test test', 'fake name']);

function normalizeName(name) {
  if (!name || typeof name !== 'string') return { valid: false, formatted: '', flagged: true, reason: 'Name is required' };

  let s = name.trim().replace(/\s+/g, ' ');

  if (s.length < 2) {
    return { valid: false, formatted: s, flagged: true, reason: 'Name is too short' };
  }

  // Title case with special prefix handling
  const formatted = s.split(' ').map(word => {
    const lower = word.toLowerCase();

    // Mc prefix: McDonald, McDowell
    if (lower.startsWith('mc') && lower.length > 2) {
      return 'Mc' + lower[2].toUpperCase() + lower.slice(3);
    }
    // O' prefix: O'Brien, O'Connor
    if (lower.startsWith("o'") && lower.length > 2) {
      return "O'" + lower[2].toUpperCase() + lower.slice(3);
    }
    // De prefix: DeLeon, DeJesus (but not "de" alone)
    if (lower.startsWith('de') && lower.length > 3 && lower[2] !== ' ') {
      return 'De' + lower[2].toUpperCase() + lower.slice(3);
    }
    // General title case
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ');

  // Check for suspicious names
  let flagged = false;
  let reason = '';

  if (TEST_NAMES.has(formatted.toLowerCase())) {
    flagged = true;
    reason = 'Name appears to be a test entry';
  } else if (formatted.split(' ').length < 2) {
    flagged = true;
    reason = 'Only one name provided — first and last name recommended';
  } else if (/\d/.test(formatted)) {
    flagged = true;
    reason = 'Name contains numbers';
  } else if (formatted.split(' ').some(w => w.length < 2)) {
    flagged = true;
    reason = 'Name contains very short words';
  }

  return { valid: true, formatted, flagged, reason };
}

// ── Master validation ──
function validateIntakeFields(body) {
  const errors = [];
  const warnings = [];
  const corrected = {};

  // Phone
  if (body.phone) {
    const phoneResult = normalizePhone(body.phone);
    if (!phoneResult.valid) {
      errors.push(phoneResult.error);
    } else {
      corrected.phone = phoneResult.formatted;
    }
  }

  // Email
  if (body.email) {
    const emailResult = normalizeEmail(body.email);
    if (!emailResult.valid) {
      errors.push(emailResult.error);
    } else {
      corrected.email = emailResult.corrected;
      if (emailResult.suggestions.length > 0) {
        warnings.push(`Email auto-corrected from ${emailResult.suggestions[0]} to ${emailResult.corrected}`);
      }
    }
  }

  // Name
  if (body.ownerName) {
    const nameResult = normalizeName(body.ownerName);
    if (!nameResult.valid) {
      errors.push(nameResult.reason);
    } else {
      corrected.ownerName = nameResult.formatted;
      if (nameResult.flagged) {
        warnings.push(`Name warning: ${nameResult.reason}`);
      }
    }
  }

  // Address validation — require street + city + state + zip
  if (body.propertyAddress) {
    const addr = body.propertyAddress.trim().replace(/\s+/g, ' ');
    corrected.propertyAddress = addr;

    // Must start with a street number
    if (!/^\d+/.test(addr)) {
      warnings.push('Address may be missing street number');
    }

    // Must contain a zip code (5 digits)
    const hasZip = /\b\d{5}\b/.test(addr);
    if (!hasZip) {
      warnings.push('Address is missing zip code — lead will be flagged for review');
    }

    // Must contain a state abbreviation or "Texas"
    const hasState = /\b(TX|Texas|tx)\b/.test(addr);
    const bodyState = (body.state || '').toUpperCase();
    if (!hasState && bodyState !== 'TX' && bodyState !== 'TEXAS') {
      warnings.push('Address may be missing state');
    }

    // Must have at least 2 comma-separated parts (street, city) or contain a city name
    const parts = addr.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length < 2 && !hasZip) {
      warnings.push('Address appears incomplete — missing city or zip');
    }
  } else {
    errors.push('Property address is required');
  }

  // State validation — Texas only
  if (body.state) {
    const st = body.state.toUpperCase().trim();
    if (st !== 'TX' && st !== 'TEXAS') {
      warnings.push(`State "${body.state}" is outside service area (Texas only) — lead will be flagged`);
    }
  }

  return {
    valid: errors.length === 0,
    corrected,
    warnings,
    errors,
  };
}

// ── Address validation ──
function validateAddress({ street, city, state, zip }) {
  const errors = [];
  const ALLOWED_STATES = ['TX', 'CO', 'GA', 'AZ', 'WA'];

  if (!street || street.trim().length < 3) errors.push('Street address is required');
  if (!city || city.trim().length < 2) errors.push('City is required');
  if (!state || !ALLOWED_STATES.includes(state.toUpperCase())) errors.push('State must be TX, CO, GA, AZ, or WA');
  if (!zip || !/^\d{5}$/.test(zip)) errors.push('Valid 5-digit zip code is required');

  return { valid: errors.length === 0, errors };
}

module.exports = { normalizePhone, normalizeEmail, normalizeName, validateIntakeFields, validateAddress };
