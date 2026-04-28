#!/usr/bin/env node
/**
 * AUDIT — files capable of generating protest PDFs/packages
 * Tyler directive 2026-04-28 15:39 CDT (msg 27013) — SUPERSEDES the 09:46 lock.
 * "all other customers must be exactly the same as this one! No exceptions"
 * Reference: OA-0027 Villarreal v2 + OA-0037 Sherman.
 *
 * Categories:
 *   APPROVED   → ONLY gen-taxnet-master-v1.js (Sherman/TaxNet residential E&U format)
 *   DEPRECATED → still in repo for archive/reference, blocked from running
 *   BLOCKED    → unauthorized, must be moved to server/deprecated/package-builders/
 *
 * NOTE: gen-taxnet-final.js was the prior "approved" generator (09:46 directive),
 * but it produces only E&U pages — NO Form 50-132. That caused the OA-0027 failure
 * at 15:39 CDT. Tyler's response (msg 27013) mandates Sherman format for ALL customers.
 */
'use strict';
const APPROVED_GEN = 'server/scripts/gen-taxnet-master-v1.js';

// helpers/services that the approved generator + state engine still use
// (these don't generate PROTEST packages on their own, but support master-v1)
const HELPERS_KEEP = [
  'server/services/form-50-162-generator.js',           // signed 50-162 PDF (post-signature)
  'server/services/form-generator.js',                   // generic form helper
  'server/services/sign-form-50-162.js',                 // signature embedding
  'server/services/map-generator.js',                    // OSM/Nominatim maps used by master-v1
  'server/lib/protest-package/package-renderer.js',      // page renderer (Form 50-132 + E&U + maps)
  'server/lib/protest-package/preflight.js',             // D1–D14 validation gates
  'server/lib/protest-package/postflight.js',            // reconciliation gates
  'server/lib/protest-package/live-case-loader.js',      // CRM/case manifest reader
  'server/lib/protest-package/error-contract.js',        // buildFailure() diagnostics
  'server/lib/protest-package/sample-fixtures.js',       // sample mode fixtures
  'server/lib/state-engine/manifest-registry.js',        // case registry
  'server/services/taxnet-package-generator.js',         // adjustment math (calcAdjustments)
];

// Unauthorized one-off / legacy / preview / case-specific builders → MOVE to deprecated
const BLOCKED_BUILDERS = [
  'server/build-OA-0013-bypass.js',
  'server/generate-juan-v4.js',
  'server/scripts/build-oa-0025-package.js',
  'server/scripts/build-oa0013-v4.js',
  'server/scripts/build-oa0022-market-value.js',
  'server/scripts/build-bexar-acreage-review.js',  // rural-acreage carve-out REVOKED
  'server/scripts/gen-all-protests.js',
  'server/scripts/gen-final-review.js',
  'server/scripts/gen-fix-protests.js',
  'server/scripts/gen-oa0022-market-value-v3.js',
  'server/scripts/gen-pdfs-v2.js',
  'server/scripts/gen-protest-filing.js',
  'server/scripts/gen-taxnet-final.js',  // missing Form 50-132; flipped from APPROVED → BLOCKED per msg 27013
  'server/scripts/gen-taxnet-pdf.js',
  'server/scripts/gen-taxnet-v3.js',
  'server/scripts/gen-taxnet-v4.js',
  'server/scripts/gen-taxnet-v5.js',
  'server/scripts/generate-protest-pdfs.js',
  'server/scripts/_villarreal_run.js',  // one-off Villarreal sandbox using wrong generator
  'server/services/evidence-generator.js',  // wrong format (was auxiliary; now disallowed for filing)
  'server/filing-automation/lib/cover-letter.js',  // cover letters not part of Sherman format
  'server/filing-automation/lib/filing-pack-builder.js'  // assembles wrong documents
];

// services that CAN generate a full package — must be guarded too
const GUARDED_SERVICES = [
  'server/services/auto-file.js',
  'server/services/auto-filing-engine.js'
];

console.log('=== APPROVED ===');
console.log('  '+APPROVED_GEN);
console.log('\n=== HELPERS (kept, not standalone generators) ===');
HELPERS_KEEP.forEach(f=>console.log('  '+f));
console.log('\n=== BLOCKED (will be moved to server/deprecated/package-builders/) ===');
BLOCKED_BUILDERS.forEach(f=>console.log('  '+f));
console.log('\n=== GUARDED (services that auto-generate; must check approved-only flag) ===');
GUARDED_SERVICES.forEach(f=>console.log('  '+f));

module.exports = { APPROVED_GEN, HELPERS_KEEP, BLOCKED_BUILDERS, GUARDED_SERVICES };
