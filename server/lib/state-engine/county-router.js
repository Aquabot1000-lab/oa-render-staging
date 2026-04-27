/**
 * county-router.js
 * Maps county names → enrichment engine IDs.
 *
 * Engine IDs:
 *   fbcad           — Fort Bend CAD BIS-search (per-case enrichment script)
 *   kaufman_parser  — KCAD PACS flat-file bulk parser (generalized)
 *   collin_blocked  — Collin TruProdigy / eSearch — BLOCKED by Cloudflare
 *   bcad_pending    — Bexar CAD — data files present, parser not yet written
 *   pending         — data files present, parser not yet written
 *   not_supported   — no data file, no parser; mark CAD_BLOCKED immediately
 *   out_of_tx       — non-TX county; out of service area
 */
'use strict';

// Canonical county → engine mapping.
// Keys are lower-cased, trimmed, and spaces collapsed.
const COUNTY_ENGINE = {
  // ── Active parsers ───────────────────────────────────────────────────────
  'fort bend':   'fbcad',
  'kaufman':     'kaufman_parser',

  // ── Blocked ──────────────────────────────────────────────────────────────
  'collin':      'collin_blocked',

  // ── Pending parsers (data files on disk) ─────────────────────────────────
  'bexar':       'bcad_pending',
  'tarrant':     'pending',
  'harris':      'pending',
  'travis':      'pending',
  'dallas':      'pending',
  'denton':      'pending',
  'williamson':  'pending',
  'galveston':   'pending',
  'montgomery':  'pending',
  'johnson':     'not_supported',
  'comal':       'not_supported',
  'el paso':     'not_supported',
  'bowie':       'not_supported',

  // ── Out of service area ───────────────────────────────────────────────────
  'king':        'out_of_tx',
  'pierce':      'out_of_tx',
  'snohomish':   'out_of_tx',
  'spokane':     'out_of_tx',
  'kitsap':      'out_of_tx',
  'ferry':       'out_of_tx',
  'stevens':     'out_of_tx',
  'yakima':      'out_of_tx',
  'fulton':      'out_of_tx',
};

// Human-readable blocker reason per engine
const ENGINE_BLOCKER = {
  collin_blocked: 'Cloudflare challenge on esearch.collincad.org — manual unblock required',
  bcad_pending:   'Bexar CAD parser not yet written; data files present',
  pending:        'County parser not yet implemented; data files may be present',
  not_supported:  'No data file and no parser; county not currently supported',
  out_of_tx:      'Outside Texas service area',
};

/**
 * Resolve the enrichment engine for a county name.
 * @param {string} county — raw county string from submissions table
 * @returns {{ engine: string, blocker: string|null, ready: boolean }}
 *   ready=true  → can run enrichment now
 *   ready=false → must be marked CAD_BLOCKED with the provided blocker string
 */
function resolveEngine(county) {
  const key = (county || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/\s+county$/i, '');
  const engine = COUNTY_ENGINE[key] || 'not_supported';
  const ready  = engine === 'fbcad' || engine === 'kaufman_parser';
  const blocker = ENGINE_BLOCKER[engine] || null;
  return { engine, blocker, ready };
}

module.exports = { resolveEngine, COUNTY_ENGINE, ENGINE_BLOCKER };
