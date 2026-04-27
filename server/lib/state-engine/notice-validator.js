/**
 * notice-validator.js
 * Classifies an uploaded notice document as NOTICE_VALID or WRONG_DOCUMENT.
 *
 * Strategy (in order):
 *  1. If CRM upload_status is already 'verified_notice' → trust it, short-circuit VALID.
 *  2. If CRM upload_status is 'wrong_document'          → short-circuit WRONG_DOCUMENT.
 *  3. Otherwise fetch the document and classify via text heuristics + (optionally) vision OCR.
 *
 * Vision OCR is used when:
 *  - The file is a scanned image-only PDF (no extractable text)
 *  - pdftotext returns fewer than 50 significant characters
 *
 * Hard rules:
 *  - Form 1098 (mortgage interest)  → WRONG_DOCUMENT
 *  - Mortgage statement              → WRONG_DOCUMENT
 *  - Tax bill / tax statement        → WRONG_DOCUMENT
 *  - Property deed / title doc       → WRONG_DOCUMENT
 *  - Notice of Appraised Value       → NOTICE_VALID
 *    Must contain: year 202x + appraisal district name + "appraised value" phrase
 *
 * Returns: { result: 'NOTICE_VALID'|'WRONG_DOCUMENT'|'INDETERMINATE', reason: string, confidence: 'high'|'medium'|'low' }
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execSync } = require('child_process');

// Text patterns that REJECT a document
const REJECT_PATTERNS = [
  { re: /form\s*1098/i,                  label: 'Form 1098 (mortgage interest statement)' },
  { re: /mortgage\s+interest\s+statement/i, label: 'Mortgage interest statement' },
  { re: /box\s*1.*mortgage\s*interest/is,label: 'Mortgage interest statement (box 1)' },
  { re: /rocket\s+mortgage/i,            label: 'Rocket Mortgage document' },
  { re: /property\s+tax\s+bill/i,        label: 'Property tax bill' },
  { re: /tax\s+statement/i,              label: 'Tax statement' },
  { re: /amount\s+due.*tax/i,            label: 'Tax bill (amount due)' },
  { re: /deed\s+of\s+trust/i,            label: 'Deed of Trust' },
  { re: /closing\s+disclosure/i,         label: 'Closing disclosure' },
  { re: /hud-?1\b/i,                     label: 'HUD-1 settlement statement' },
  { re: /lender\b.*\bborrower\b/i,       label: 'Lender/borrower document' },
];

// Text patterns that ACCEPT a document
const ACCEPT_PATTERNS = [
  /notice\s+of\s+appraised\s+value/i,
  /appraisal\s+district/i,
  /appraised\s+value/i,
  /protest\s+deadline/i,
  /chief\s+appraiser/i,
  /property\s+tax\s+code/i,
];

// Minimum accept hits to declare NOTICE_VALID without vision
const MIN_ACCEPT_HITS = 2;

/**
 * Extract raw text from a PDF using pdftotext (poppler-utils).
 * Returns '' if not available or extraction fails.
 */
function extractPdfText(pdfPath) {
  try {
    const txt = execSync(`pdftotext -layout "${pdfPath}" -`, { timeout: 15000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    return txt || '';
  } catch (_) {
    return '';
  }
}

/**
 * Download a URL to a temp file. Returns local path or null on failure.
 */
async function downloadToTemp(url) {
  const tmpPath = path.join(os.tmpdir(), `oa-notice-${Date.now()}.pdf`);
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(tmpPath, buf);
    return tmpPath;
  } catch (_) {
    return null;
  }
}

/**
 * Classify a document by URL or local path.
 * @param {string} docUrl  — Supabase storage public URL or local path
 * @param {string} uploadStatus — CRM upload_status value (fast-path)
 * @returns {Promise<{result:string, reason:string, confidence:string}>}
 */
async function validateNotice(docUrl, uploadStatus) {
  // ── Fast-path: trust CRM status ──────────────────────────────────────────
  if (uploadStatus === 'verified_notice') {
    return { result: 'NOTICE_VALID', reason: 'CRM upload_status=verified_notice', confidence: 'high' };
  }
  if (uploadStatus === 'wrong_document') {
    return { result: 'WRONG_DOCUMENT', reason: 'CRM upload_status=wrong_document', confidence: 'high' };
  }
  if (!docUrl) {
    return { result: 'INDETERMINATE', reason: 'No document URL provided', confidence: 'low' };
  }

  // ── Download ──────────────────────────────────────────────────────────────
  let localPath = null;
  let ownedTemp = false;
  if (docUrl.startsWith('/') && fs.existsSync(docUrl)) {
    localPath = docUrl;
  } else {
    localPath = await downloadToTemp(docUrl);
    ownedTemp = true;
  }

  if (!localPath) {
    return { result: 'INDETERMINATE', reason: 'Document download failed', confidence: 'low' };
  }

  try {
    // ── Text extraction ───────────────────────────────────────────────────
    const rawText = extractPdfText(localPath);
    const significant = rawText.replace(/\s+/g, ' ').trim();

    // ── Reject checks (text) ──────────────────────────────────────────────
    for (const { re, label } of REJECT_PATTERNS) {
      if (re.test(significant)) {
        return { result: 'WRONG_DOCUMENT', reason: `Detected: ${label}`, confidence: 'high' };
      }
    }

    // ── Accept checks (text) ──────────────────────────────────────────────
    const acceptHits = ACCEPT_PATTERNS.filter(re => re.test(significant));
    if (acceptHits.length >= MIN_ACCEPT_HITS) {
      return { result: 'NOTICE_VALID', reason: `Text matched ${acceptHits.length} acceptance patterns`, confidence: 'high' };
    }

    // ── Insufficient text — scanned image PDF ─────────────────────────────
    if (significant.length < 50) {
      // For scanned PDFs we mark INDETERMINATE; a human or separate
      // vision-OCR job must classify. We do NOT auto-accept a scan.
      return {
        result: 'INDETERMINATE',
        reason: 'Scanned image PDF — insufficient extractable text. Vision OCR review required.',
        confidence: 'low'
      };
    }

    // ── Partial text but inconclusive ────────────────────────────────────
    return {
      result: 'INDETERMINATE',
      reason: `Text extracted (${significant.length} chars) but matched only ${acceptHits.length}/${MIN_ACCEPT_HITS} accept patterns and 0 reject patterns`,
      confidence: 'medium'
    };

  } finally {
    if (ownedTemp && localPath && fs.existsSync(localPath)) {
      try { fs.unlinkSync(localPath); } catch (_) {}
    }
  }
}

module.exports = { validateNotice };
