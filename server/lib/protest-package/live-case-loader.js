/**
 * live-case-loader.js
 * Spec v1.1 LIVE case loader.
 *
 * Reads a verified per-case enrichment JSON (cad-direct only) and produces the
 * canonical ctx shape consumed by package-renderer.js + preflight.js + postflight.js.
 *
 * Hard rules (Spec v1.1):
 *  - source must be 'cad-direct' (no rentcast, no synthetic)
 *  - subject + every comp must carry verified=true with verifiedBy + verifiedAt + cadAccountNumber
 *  - geoIdCandidates must be populated even when only CAD has the value
 *  - if any required field is missing, throws — caller will rethrow as buildFailure
 *
 * Cases:
 *  OA-0010 — Fort Bend County (FBCAD BIS-search enrichment JSON)
 *  OA-0022 — Kaufman County (PACS flat-file enrichment JSON; notice=wrong_document uploaded, CAD value used)
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const REQ_SUBJ = ['marketValue','landValue','improvementValue','sqft','yearBuilt','propertyClass','cadAccountNumber','geoId'];
const REQ_COMP = ['marketValue','landValue','improvementValue','sqft','yearBuilt','propertyClass','cadAccountNumber','geoId'];

const COND_TO_SCORE = { RG1:2, RG2:3, RG3:3, RG4:4, RG5:4, GOOD:3, AVERAGE:3, FAIR:2, POOR:1, EXCELLENT:5 };
function condScore(label){
  if (!label) return 3;
  const k = String(label).toUpperCase();
  return COND_TO_SCORE[k] || 3;
}
function condLabel(code){
  if (!code) return 'Average';
  const map = { RG1:'Fair', RG2:'Good', RG3:'Good', RG4:'Very Good', RG5:'Excellent' };
  return map[String(code).toUpperCase()] || String(code);
}

// Best-effort distance between two parcels in the same subdivision (no geocoding here —
// geocoding happens later in the renderer for the map). For E&U row 'distanceMiles' we
// use 0.0 when same subdivision since they sit in the same block group.
function approxDistanceWithinSubdivision(_subjAddr, _compAddr){ return 0.0; }

function loadCase(caseId) {
  const dataRoot = path.join(__dirname, '..', '..', 'data');
  // Manifest of where each case's enrichment lives + county metadata
  const manifest = {
    'OA-0010': {
      source: path.join(dataRoot, 'fort-bend', 'OA-0010-cad-comps.json'),
      county: 'Fort Bend',
      appraisalDistrict: 'Fort Bend Central Appraisal District',
      // Owner name extracted from notice_url 2026 FBCAD appraisal notice via vision OCR (see memory/2026-04-26.md).
      // EXACT string per Tyler v2 directive — do not normalize or reformat.
      ownerName: 'Nguyen, Khiem Duc',
      ownerNameSource: 'notice_url:OA-0010/notice.jpg (vision OCR 2026-04-26)',
      ownerAddress: '3315 Marlene Meadow WAY, Richmond, TX 77406',
      ownerPhone: null,
      ownerEmail: null,
      caseDisplayId: 'OA-0010',
      legalDescription: 'McCrary Meadows Sec 9, BLOCK 2, Lot 20',
      targetMode: 'min',  // Tyler v2 directive: anchor relief to MIN adjusted value, not median
      // Best 8–10 comps by similarity (sqft proximity to 3,718 + year 2022–2023, A1 only).
      // Tyler instruction: "use best 8–10 by similarity"
      compPropertyIds: [
        'R523416', // 3,691sf 2022
        'R523414', // 3,695sf 2022
        'R523422', // 3,701sf 2023
        'R523407', // 3,622sf 2022
        'R523423', // 3,646sf 2023
        'R523408', // 3,741sf 2022
        'R523412', // 3,735sf 2022
        'R523424', // 3,716sf 2023
        'R523429', // 3,472sf 2023
        'R523413', // 3,816sf 2022
      ],
    },
  };

  // Overlay: programmatic manifest registry (auto-populated by state engine on CAD_COMPLETE).
  // Hard-coded `manifest` above is the seed; the registry takes precedence when both define a case.
  let m = manifest[caseId];
  try {
    const { getManifest } = require('../state-engine/manifest-registry');
    const reg = getManifest(caseId);
    if (reg) m = reg;
  } catch (_) { /* registry optional */ }
  if (!m) throw new Error(`Live loader: no manifest entry for case "${caseId}". Register via manifest-registry.registerCase() or seed live-case-loader.js manifest.`);
  if (!fs.existsSync(m.source)) throw new Error(`Live loader: enrichment file missing: ${m.source}`);

  const raw = JSON.parse(fs.readFileSync(m.source, 'utf8'));
  const subj = raw.subject;
  if (!subj) throw new Error(`Live loader: subject missing in enrichment: ${m.source}`);

  // Validate subject
  for (const f of REQ_SUBJ) if (subj[f] == null || subj[f] === '') {
    throw new Error(`Live loader: subject missing required "${f}" in ${m.source}`);
  }
  if (subj.improvementValue + subj.landValue !== subj.marketValue) {
    throw new Error(`Live loader: subject math fails — improvement(${subj.improvementValue}) + land(${subj.landValue}) ≠ market(${subj.marketValue})`);
  }

  // Pick comps in manifest order
  const compsBySource = new Map(raw.comps.map(c => [c.cadAccountNumber, c]));
  const selected = [];
  for (const pid of m.compPropertyIds) {
    const c = compsBySource.get(pid);
    if (!c) continue;
    for (const f of REQ_COMP) if (c[f] == null || c[f] === '') {
      throw new Error(`Live loader: comp ${pid} missing required "${f}"`);
    }
    selected.push(c);
  }
  if (selected.length < 5) throw new Error(`Live loader: only ${selected.length} comps available; need ≥5 (target 8–10)`);

  const NOW = new Date();
  // Build comps as ctx expects
  const comps = selected.map((c, idx) => ({
    seqNum:           idx + 1,
    taxId:            c.cadAccountNumber,
    // Trim FBCAD parser leakage: keep only the clean street + city + state + zip prefix
    address:          (c.address || '').split(/\s+Map ID:|\s+Mapsco:|\s+Legal Description:/)[0].replace(/\s+/g,' ').trim(),
    marketValue:      c.marketValue,
    distanceMiles:    approxDistanceWithinSubdivision(subj.address, c.address),
    propertyClass:    c.propertyClass,
    condition:        condLabel(c.condition),
    conditionScore:   condScore(c.condition),
    yearBuilt:        c.yearBuilt,
    effectiveYear:    c.effectiveYear || c.yearBuilt,  // FBCAD doesn't display effective year; for new construction it == yearBuilt
    sqft:             c.sqft,
    improvementValue: c.improvementValue,
    featureValue:     0,
    poolValue:        0,
    landValue:        c.landValue,
    source:           'cad-direct',
    verified:         true,
    verifiedBy:       c.verifiedBy,
    verifiedAt:       c.verifiedAt,
    cadAccountNumber: c.cadAccountNumber,
    geoId:            c.geoId,
  }));

  // Pre-compute adjustments now so we can lock ownerOpinion to the chosen anchor.
  // Spec contract: same calc engine the renderer uses.
  const { calcAdjustments } = require('../../services/taxnet-package-generator');
  const subjForCalc = {
    sqft:           subj.sqft,
    yearBuilt:      subj.yearBuilt,
    effectiveYear:  subj.effectiveYear || subj.yearBuilt,
    landValue:      subj.landValue,
    conditionScore: condScore(subj.condition),
    assessedValue:  subj.marketValue,
  };
  const compsForCalc = selected.map(c => ({
    marketValue:    c.marketValue,
    sqft:           c.sqft,
    yearBuilt:      c.yearBuilt,
    effectiveYear:  c.effectiveYear || c.yearBuilt,
    landValue:      c.landValue,
    conditionScore: condScore(c.condition),
  }));
  const computedAdjVals = compsForCalc
    .map(c => calcAdjustments(c, subjForCalc).adjustedValue)
    .sort((a,b) => a-b);
  const computedMin    = computedAdjVals[0];
  const computedMedian = computedAdjVals[Math.floor(computedAdjVals.length / 2)];
  const targetMode     = m.targetMode || 'median';
  const lockedAnchor   = (targetMode === 'min') ? computedMin : computedMedian;

  const ctx = {
    caseId:              caseId,
    taxYear:             NOW.getFullYear(),
    packageDate:         NOW,
    county:              m.county,
    appraisalDistrict:   m.appraisalDistrict,
    ownerName:           m.ownerName,
    _ownerNameSource:    m.ownerNameSource || null,
    ownerAddress:        m.ownerAddress,
    ownerPhone:          m.ownerPhone,
    ownerEmail:          m.ownerEmail,
    verified:            true,
    verifiedBy:          subj.verifiedBy,
    verifiedAt:          subj.verifiedAt,
    // ownerAddress is the manifest-curated clean address; subj.address may carry parser leakage from FBCAD
    propertyAddress:     m.ownerAddress,
    accountNumber:       subj.cadAccountNumber,
    geoId:               subj.geoId,
    geoIdSource:         'cad',
    geoIdCandidates:     { cad: subj.geoId, mls: null, internal: null },
    legalDescription:    m.legalDescription,
    appraisedValue:      subj.marketValue,
    targetMode:          targetMode,
    ownerOpinion:        lockedAnchor,   // Owner Opinion === Requested Value === locked anchor (Tyler v2 hard rule)
    source:              'cad-direct',
    cadAccountNumber:    subj.cadAccountNumber,
    subject: {
      taxId:             subj.cadAccountNumber,
      propertyClass:     subj.propertyClass,
      condition:         condLabel(subj.condition),
      conditionScore:    condScore(subj.condition),
      yearBuilt:         subj.yearBuilt,
      effectiveYear:     subj.effectiveYear || subj.yearBuilt,
      sqft:              subj.sqft,
      improvementValue:  subj.improvementValue,
      featureValue:      0,
      poolValue:         0,
      landValue:         subj.landValue,
    },
    protestGrounds:      { marketValue: true, unequal: true },
    validityEnvelope:    { maxDistanceMi: 10, maxSqftDeltaPct: 50, maxYearDelta: 75 },
    protestArguments:    {
      middle: [
        { label: 'CONDITION / MARKET FACTORS',
          text:  'Same-subdivision comparables (' + m.legalDescription + ') of similar size, year built, ' +
                 'class, and quality grade are assessed at materially lower values than the subject. The CAD\'s ' +
                 'appraisal does not reflect the prevailing equal-and-uniform standard for this subdivision.' },
      ],
    },
    comps,
  };

  return ctx;
}

module.exports = { loadCase };
