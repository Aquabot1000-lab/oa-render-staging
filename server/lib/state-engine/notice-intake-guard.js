/**
 * notice-intake-guard.js
 * Authoritative gate for incoming notice uploads.
 *
 * Wraps notice-validator with:
 *  - Mime/extension fast-path (image vs pdf)
 *  - Filename heuristics for known wrong patterns
 *  - PDF text extraction (notice-validator)
 *  - Vision OCR fallback for scanned/image-only PDFs and image uploads
 *
 * Returns:
 *   { result: 'NOTICE_VALID' | 'WRONG_DOCUMENT' | 'INDETERMINATE',
 *     reason: string,
 *     confidence: 'high'|'medium'|'low',
 *     uploadStatus: 'verified_notice' | 'wrong_document' | 'uploaded',  // suggested DB value
 *     visionUsed: boolean }
 *
 * The route handler calls classifyUpload() AFTER the file is in storage.
 * If result === WRONG_DOCUMENT we set upload_status='wrong_document' and
 * the state engine moves the case to WRONG_DOCUMENT on the next reconcile.
 *
 * NEVER auto-accepts a scanned image without a strong positive signal.
 * INDETERMINATE leaves upload_status='uploaded' for human review.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execSync } = require('child_process');
const { validateNotice } = require('./notice-validator');

// Filename keywords that strongly indicate a non-notice document
const FILENAME_REJECT = [
  /\b1098\b/i,
  /mortgage/i,
  /closing.?disclosure/i,
  /hud-?1\b/i,
  /deed/i,
  /\btitle\b/i,
  /survey/i,
  /\binsurance\b/i,
  /escrow/i,
];

// Filename keywords that are positive but not sufficient on their own
const FILENAME_NOTICE = [
  /\bnotice\b/i,
  /apprais/i,
  /\bcad\b/i,
  /\bnov\b/i,
  /value/i,
];

/**
 * Classify by filename only (cheap, fast).
 * Returns { hint: 'notice'|'reject'|'unknown', match: string|null }
 */
function filenameHint(originalName) {
  const n = (originalName || '').toLowerCase();
  for (const re of FILENAME_REJECT) {
    if (re.test(n)) return { hint: 'reject', match: re.source };
  }
  for (const re of FILENAME_NOTICE) {
    if (re.test(n)) return { hint: 'notice', match: re.source };
  }
  return { hint: 'unknown', match: null };
}

/**
 * Convert a single page of a PDF or an image to a temp JPEG for vision OCR.
 * Returns local path to JPEG, or null if conversion failed.
 */
function ensureJpeg(localPath) {
  if (!fs.existsSync(localPath)) return null;
  const ext = path.extname(localPath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') return localPath;

  // Try pdftoppm first (works on real PDFs)
  const base = path.join(os.tmpdir(), `oa-notice-vision-${Date.now()}`);
  try {
    execSync(`pdftoppm -jpeg -r 120 -f 1 -l 1 "${localPath}" "${base}"`, { stdio: 'pipe', timeout: 15000 });
    const out = base + '-1.jpg';
    if (fs.existsSync(out)) return out;
  } catch (_) {}

  // Fallback: maybe the file is actually a JPEG with .pdf extension
  // Read first 4 bytes to detect magic
  try {
    const fd = fs.openSync(localPath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    if (buf[0] === 0xFF && buf[1] === 0xD8) {
      // JPEG magic — copy with proper extension
      const out = base + '.jpg';
      fs.copyFileSync(localPath, out);
      return out;
    }
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
      const out = base + '.png';
      fs.copyFileSync(localPath, out);
      return out;
    }
  } catch (_) {}

  return null;
}

/**
 * Main guard. Call this after the file is uploaded to storage.
 *
 * @param {object} args
 * @param {string} args.localPath          — absolute path to file on disk (multer dest or temp)
 * @param {string} args.originalName       — original filename (req.file.originalname)
 * @param {string} args.mimeType           — req.file.mimetype
 * @param {string} [args.caseId]           — for logging only
 * @returns {Promise<{result,reason,confidence,uploadStatus,visionUsed}>}
 */
async function classifyUpload({ localPath, originalName, mimeType, caseId }) {
  const fn = filenameHint(originalName);

  // ── 1. Filename reject is decisive ───────────────────────────────────────
  if (fn.hint === 'reject') {
    return {
      result:       'WRONG_DOCUMENT',
      reason:       `Filename matches reject pattern (${fn.match})`,
      confidence:   'high',
      uploadStatus: 'wrong_document',
      visionUsed:   false,
    };
  }

  // ── 2. Text-based validator (works on real PDFs) ─────────────────────────
  let textResult = null;
  if (mimeType === 'application/pdf' || /\.pdf$/i.test(originalName)) {
    textResult = await validateNotice(localPath, null);
    if (textResult.result === 'WRONG_DOCUMENT') {
      return {
        ...textResult,
        uploadStatus: 'wrong_document',
        visionUsed: false,
      };
    }
    if (textResult.result === 'NOTICE_VALID' && textResult.confidence === 'high') {
      return {
        ...textResult,
        uploadStatus: 'verified_notice',
        visionUsed: false,
      };
    }
    // INDETERMINATE → fall through to vision
  }

  // ── 3. Vision OCR fallback ───────────────────────────────────────────────
  const jpegPath = ensureJpeg(localPath);
  if (!jpegPath) {
    return {
      result:       'INDETERMINATE',
      reason:       textResult ? textResult.reason : 'Could not extract text or image for vision',
      confidence:   'low',
      uploadStatus: 'uploaded',
      visionUsed:   false,
    };
  }

  // Vision call — uses anthropic vision via existing OpenAI-compatible bridge
  // Lazy require to keep this module importable in tests.
  let visionResult;
  try {
    visionResult = await runVisionClassifier(jpegPath, caseId);
  } catch (err) {
    console.error(`[notice-guard] vision error for ${caseId || originalName}:`, err.message);
    return {
      result:       'INDETERMINATE',
      reason:       `Vision OCR failed: ${err.message}`,
      confidence:   'low',
      uploadStatus: 'uploaded',
      visionUsed:   false,
    };
  } finally {
    // clean temp jpeg if we created it
    if (jpegPath !== localPath) {
      try { fs.unlinkSync(jpegPath); } catch (_) {}
    }
  }

  return {
    result:       visionResult.classification,
    reason:       visionResult.reason,
    confidence:   visionResult.confidence,
    uploadStatus:
      visionResult.classification === 'NOTICE_VALID'    ? 'verified_notice' :
      visionResult.classification === 'WRONG_DOCUMENT'  ? 'wrong_document'  :
                                                          'uploaded',
    visionUsed:   true,
  };
}

/**
 * Vision classifier wrapper.
 * Uses OpenAI/Anthropic vision API via env keys; returns:
 *   { classification: 'NOTICE_VALID'|'WRONG_DOCUMENT'|'INDETERMINATE',
 *     reason: string, confidence: 'high'|'medium'|'low' }
 *
 * Strict prompt — only accepts clear Texas Notice of Appraised Value documents.
 */
async function runVisionClassifier(imagePath, caseId) {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return { classification: 'INDETERMINATE', reason: 'No vision API key configured', confidence: 'low' };
  }

  const imageBytes = fs.readFileSync(imagePath);
  const b64 = imageBytes.toString('base64');
  const ext = path.extname(imagePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';

  const prompt = `You are classifying a single-page document image for a Texas property tax protest pipeline.

Possible classifications (return EXACTLY one):
  NOTICE_VALID    — A Texas Notice of Appraised Value letter from a county appraisal district.
                    Must show: appraisal district name, property owner, property address,
                    appraised/market value, and tax year (2024, 2025, or 2026).
  WRONG_DOCUMENT  — Any of: IRS Form 1098, mortgage statement, tax bill, deed,
                    closing disclosure, blank/white page, photograph, screenshot of a CAD
                    website (NOT the formal mailed notice), or any non-notice document.
  INDETERMINATE   — Image is too unclear to classify with confidence.

Reply ONLY with JSON:
  {"classification":"...", "reason":"<one sentence>", "confidence":"high|medium|low"}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
          { type: 'text',  text: prompt },
        ],
      }],
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) throw new Error(`vision http ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const text = (j.content && j.content[0] && j.content[0].text) || '';
  const m = text.match(/\{[\s\S]*?\}/);
  if (!m) throw new Error(`vision returned no JSON: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(m[0]);
  if (!['NOTICE_VALID','WRONG_DOCUMENT','INDETERMINATE'].includes(parsed.classification)) {
    throw new Error(`vision returned invalid classification: ${parsed.classification}`);
  }
  return parsed;
}

module.exports = { classifyUpload, filenameHint, runVisionClassifier };
