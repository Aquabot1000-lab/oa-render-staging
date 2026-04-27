/**
 * manifest-registry.js
 * Replaces hand-edited entries in live-case-loader.js with a JSON registry
 * that is appended programmatically when CAD enrichment completes.
 *
 * Storage: server/data/shared/case-manifest.json
 *
 * Schema (per case):
 * {
 *   caseId: 'OA-XXXX',
 *   source: 'absolute path to <case>-cad-comps.json',
 *   county: 'Fort Bend',
 *   appraisalDistrict: 'Fort Bend Central Appraisal District',
 *   ownerName: 'EXACT string from notice',
 *   ownerNameSource: 'audit string',
 *   ownerAddress: '...',
 *   legalDescription: '...',
 *   targetMode: 'min'|'median',
 *   compPropertyIds: [...],
 *   registeredAt: ISO timestamp,
 *   registeredBy: 'state-engine'|'manual'
 * }
 *
 * The legacy live-case-loader.js manifest is preserved as a fallback;
 * this registry overlays/extends it. New auto-registered cases land here only.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const REGISTRY_PATH = path.join(__dirname, '..', '..', 'data', 'shared', 'case-manifest.json');

const COUNTY_DISTRICT = {
  'Fort Bend':  'Fort Bend Central Appraisal District',
  'Kaufman':    'Kaufman Central Appraisal District',
  'Collin':     'Collin Central Appraisal District',
  'Bexar':      'Bexar Appraisal District',
  'Tarrant':    'Tarrant Appraisal District',
  'Harris':     'Harris Central Appraisal District',
  'Travis':     'Travis Central Appraisal District',
  'Dallas':     'Dallas Central Appraisal District',
  'Denton':     'Denton Central Appraisal District',
  'Williamson': 'Williamson Central Appraisal District',
  'Galveston':  'Galveston Central Appraisal District',
  'Montgomery': 'Montgomery Central Appraisal District',
};

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')); }
  catch (_) { return {}; }
}

function saveRegistry(reg) {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2));
}

/**
 * Auto-register a case once CAD enrichment is complete.
 *
 * @param {object} args
 * @param {string} args.caseId
 * @param {string} args.enrichmentPath  — absolute path to <case>-cad-comps.json
 * @param {string} args.county
 * @param {string} args.ownerName
 * @param {string} args.ownerAddress
 * @param {string} args.legalDescription
 * @param {string[]} args.compPropertyIds — at least 5
 * @param {object} [args.opts]            — { targetMode: 'min'|'median', ownerNameSource, registeredBy }
 * @returns {{ entry: object, registered: boolean, alreadyExists: boolean }}
 */
function registerCase({ caseId, enrichmentPath, county, ownerName, ownerAddress, legalDescription, compPropertyIds, opts = {} }) {
  if (!caseId)            throw new Error('manifest-registry: caseId required');
  if (!enrichmentPath)    throw new Error('manifest-registry: enrichmentPath required');
  if (!fs.existsSync(enrichmentPath)) throw new Error(`manifest-registry: enrichment file does not exist: ${enrichmentPath}`);
  if (!county)            throw new Error('manifest-registry: county required');
  if (!ownerName)         throw new Error('manifest-registry: ownerName required');
  if (!Array.isArray(compPropertyIds) || compPropertyIds.length < 5) {
    throw new Error(`manifest-registry: compPropertyIds must be array of ≥5; got ${compPropertyIds && compPropertyIds.length}`);
  }

  const reg = loadRegistry();
  if (reg[caseId]) {
    return { entry: reg[caseId], registered: false, alreadyExists: true };
  }

  const entry = {
    caseId,
    source:            enrichmentPath,
    county,
    appraisalDistrict: COUNTY_DISTRICT[county] || `${county} Appraisal District`,
    ownerName,
    ownerNameSource:   opts.ownerNameSource || 'cad-direct',
    ownerAddress:      ownerAddress || '',
    ownerPhone:        null,
    ownerEmail:        null,
    caseDisplayId:     caseId,
    legalDescription:  legalDescription || '',
    targetMode:        opts.targetMode || 'min',
    compPropertyIds,
    registeredAt:      new Date().toISOString(),
    registeredBy:      opts.registeredBy || 'state-engine',
  };

  reg[caseId] = entry;
  saveRegistry(reg);
  return { entry, registered: true, alreadyExists: false };
}

/**
 * Look up a case manifest entry. Returns null if not registered.
 */
function getManifest(caseId) {
  const reg = loadRegistry();
  return reg[caseId] || null;
}

/**
 * List all registered case IDs.
 */
function listRegistered() {
  return Object.keys(loadRegistry());
}

module.exports = { registerCase, getManifest, listRegistered, REGISTRY_PATH };
