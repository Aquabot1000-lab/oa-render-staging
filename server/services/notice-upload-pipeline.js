/**
 * services/notice-upload-pipeline.js
 *
 * Strict notice validation + auto-quarantine + auto-email pipeline.
 * Authorized: Tyler msg 28178 (2026-05-01 14:48 CDT).
 *
 * Validates any file landing under documents/notices/<case>/. Required signals:
 *   1. "Notice of Appraised Value" / "Notice of Protest" / similar header
 *   2. Tax year 2026 (or current year)
 *   3. Appraised value (number)
 *   4. Mailing date OR protest deadline
 *   5. CAD name
 *
 * On FAIL:
 *   - Move to documents/evidence/<case>/<filename> and remove from /notices/
 *   - Clear notice_url, notice_file, notice_of_value
 *   - status -> BLOCKED_MISSING_VALID_NOTICE (manual_status_lock=true if not already)
 *   - Send clarification email to customer (template below)
 *   - activity_log: invalid_notice_quarantined
 *
 * On PASS:
 *   - Keep file in /notices/, set notice_url
 *   - Extract: assessed_value, mailing_date, account_id, cad_name, prior_year_value, protest_deadline
 *   - Merge extracted fields into property_data
 *   - status -> NOTICE_RECEIVED
 *   - activity_log: notice_validated
 *   - Returns next_step='build_or_finalize_package' so caller can trigger build
 *
 * Returns:
 *   {
 *     result: 'PASS' | 'FAIL' | 'INDETERMINATE',
 *     confidence: 'high' | 'medium' | 'low',
 *     reason: string,
 *     extracted: { assessed_value, mailing_date, account_id, cad_name, prior_year_value, protest_deadline, owner_name, property_address, tax_year, legal_description },
 *     actions_taken: string[],
 *     next_step: 'build_or_finalize_package' | 'await_correct_upload' | null,
 *   }
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
// State controller: all status mutations go here (Tyler msg 28194)
const { updateCaseState } = require('./state-controller');

const REQUIRED_FIELDS = ['assessed_value', 'mailing_date_or_protest_deadline', 'cad_name'];
const VISION_MODEL = 'claude-sonnet-4-5-20250929';

// ---------- helpers ----------

function ensureJpeg(localPath) {
  const ext = path.extname(localPath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') return localPath;
  if (ext === '.pdf') {
    const out = path.join(os.tmpdir(), `oa-notice-${Date.now()}.jpg`);
    try {
      execSync(`pdftoppm -jpeg -r 200 -f 1 -singlefile "${localPath}" "${out.replace(/\.jpg$/, '')}"`,
        { stdio: 'pipe' });
      if (fs.existsSync(out)) return out;
    } catch (e) {
      throw new Error(`pdf-to-jpeg failed: ${e.message}`);
    }
  }
  throw new Error(`unsupported file type: ${ext}`);
}

async function downloadToTemp(url) {
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const ext = (url.match(/\.([a-z0-9]{3,4})(\?|$)/i) || [])[1] || 'jpg';
  const out = path.join(os.tmpdir(), `oa-notice-dl-${Date.now()}.${ext}`);
  fs.writeFileSync(out, buf);
  return { localPath: out, size: buf.length, buf };
}

// ---------- vision call: classify + extract in one shot ----------

async function classifyAndExtract(imagePath, caseId) {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const b64 = fs.readFileSync(imagePath).toString('base64');
  const ext = path.extname(imagePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';

  const prompt = `You are validating a document for a Texas property-tax protest pipeline (case ${caseId || 'unknown'}).

Decide if this image is a VALID Notice of Appraised Value (NOV) — the legal document mailed by a Texas county appraisal district that establishes a property's 2026 (or current year) appraised value and starts the protest deadline clock.

Required signals for VALID (ALL must be present or strongly implied):
  - Header: "Notice of Appraised Value" / "Notice of Protest" / equivalent CAD letter heading
  - Tax year 2026 (or 2025/2024 if explicitly stated)
  - A numeric appraised/market value for the subject property
  - A mailing date OR a protest deadline date
  - Issuing CAD name (e.g. Kaufman CAD, Bexar CAD, Dallas CAD, Travis CAD, Tarrant CAD, Harris CAD)

REJECT (return INVALID) for any of:
  - IRS Form 1098 / mortgage interest statement
  - Tax bill / tax statement (mailed in fall, not a NOV)
  - Mortgage statement, deed, closing disclosure, insurance form
  - CAD website screenshot — property characteristics page, search result, or detail page (NOT the formal mailed letter — these lack mailing date and deadline)
  - Blank page, photograph of unrelated thing, illegible scan
  - Last year's notice (if year clearly says 2023 or earlier)

Also EXTRACT every field you can see (use null for fields not visible). Reply with EXACTLY this JSON shape:

{
  "result": "VALID" | "INVALID" | "INDETERMINATE",
  "confidence": "high" | "medium" | "low",
  "reason": "<one sentence explaining the decision>",
  "doc_subtype": "notice_of_appraised_value" | "tax_bill" | "form_1098" | "mortgage_statement" | "deed" | "cad_website_screenshot" | "property_detail_page" | "tax_appraisal_search_result" | "photo" | "other",
  "extracted": {
    "tax_year": 2026 | null,
    "cad_name": "Kaufman CAD" | null,
    "owner_name": "..." | null,
    "property_address": "..." | null,
    "account_id": "..." | null,
    "geo_id": "..." | null,
    "legal_description": "..." | null,
    "assessed_value": 393984 | null,
    "land_value": 100000 | null,
    "improvement_value": 293984 | null,
    "prior_year_value": 350000 | null,
    "mailing_date": "2026-04-15" | null,
    "protest_deadline": "2026-05-15" | null
  }
}

Return JSON only — no markdown, no preamble.`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: VISION_MODEL, max_tokens: 800,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
        { type: 'text', text: prompt },
      ]}],
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!r.ok) throw new Error(`vision http ${r.status}: ${(await r.text()).slice(0,200)}`);
  const j = await r.json();
  const text = (j.content?.[0]?.text) || '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`no JSON in vision response: ${text.slice(0,200)}`);
  const parsed = JSON.parse(m[0]);
  if (!['VALID','INVALID','INDETERMINATE'].includes(parsed.result)) {
    throw new Error(`bad result value: ${parsed.result}`);
  }
  return parsed;
}

// ---------- field-completeness gate (final defensive check) ----------

function hasRequiredFields(ex) {
  if (!ex) return { ok: false, missing: ['extraction failed entirely'] };
  const missing = [];
  if (!ex.assessed_value || ex.assessed_value < 1000) missing.push('assessed_value');
  if (!ex.mailing_date && !ex.protest_deadline)       missing.push('mailing_date_or_protest_deadline');
  if (!ex.cad_name)                                    missing.push('cad_name');
  // Tax year recency check
  if (ex.tax_year && ex.tax_year < 2025)               missing.push('current_tax_year (got ' + ex.tax_year + ')');
  return { ok: missing.length === 0, missing };
}

// ---------- main pipeline ----------

/**
 * Validate + route an uploaded notice file.
 *
 * @param {object} opts
 * @param {string} opts.caseId - "OA-0022"
 * @param {string} opts.storagePath - "notices/OA-0022/notice.jpg" (path inside the documents bucket)
 * @param {object} opts.supabaseClient - service-role Supabase client
 * @param {object} [opts.sgMail] - SendGrid mail client (optional; if missing, email is skipped)
 * @param {object} [opts.team] - internal-team module (for BCC); falls back to require('./internal-team')
 * @param {boolean} [opts.dryRun=false]
 */
async function processNoticeUpload(opts) {
  const { caseId, storagePath, supabaseClient: sb, sgMail, dryRun = false } = opts;
  const team = opts.team || require('./internal-team');
  const NOW = new Date().toISOString();
  const actions = [];

  if (!caseId || !storagePath || !sb) throw new Error('caseId, storagePath, supabaseClient required');

  console.log(`[notice-pipeline] ${caseId} start | storagePath=${storagePath}`);

  // 1. Resolve a public URL for the stored file & download to temp
  const fullUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/documents/${storagePath}`;
  const { localPath, size, buf } = await downloadToTemp(fullUrl);
  console.log(`[notice-pipeline] ${caseId} downloaded ${size} bytes`);

  // 2. Classify + extract
  let visionResult;
  try {
    const jpegPath = ensureJpeg(localPath);
    visionResult = await classifyAndExtract(jpegPath, caseId);
  } catch (e) {
    console.error(`[notice-pipeline] ${caseId} vision error:`, e.message);
    visionResult = { result: 'INDETERMINATE', confidence: 'low', reason: 'vision-error: ' + e.message, doc_subtype: 'other', extracted: {} };
  }

  // 3. Field-completeness gate
  const fields = hasRequiredFields(visionResult.extracted);
  console.log(`[notice-pipeline] ${caseId} vision=${visionResult.result}/${visionResult.confidence} | doc_subtype=${visionResult.doc_subtype} | fields_missing=[${fields.missing.join(',')}]`);

  // Final decision: VALID iff vision says VALID AND all required fields are extracted
  const finalResult =
    visionResult.result === 'VALID' && fields.ok
      ? 'PASS'
      : visionResult.result === 'INDETERMINATE'
        ? 'INDETERMINATE'
        : 'FAIL';

  const reason = finalResult === 'PASS'
    ? visionResult.reason
    : `${visionResult.reason}${fields.missing.length ? ' | missing: ' + fields.missing.join(', ') : ''}`;

  // ---------- PASS path ----------
  if (finalResult === 'PASS') {
    if (dryRun) return { result: 'PASS', confidence: visionResult.confidence, reason, extracted: visionResult.extracted, actions_taken: ['DRY-RUN — no DB writes'], next_step: 'build_or_finalize_package' };

    const ex = visionResult.extracted;
    const noticeUrl = fullUrl;

    // Get current property_data + meta to merge notice-specific fields
    const { data: cur } = await sb.from('submissions').select('property_data,filing_package_meta,assessed_value').eq('case_id', caseId).single();
    const newPropData = {
      ...(cur?.property_data || {}),
      ...(ex.assessed_value && { assessedValue: ex.assessed_value }),
      ...(ex.land_value && { landValue: ex.land_value }),
      ...(ex.improvement_value && { improvementValue: ex.improvement_value }),
      ...(ex.account_id && { accountNumber: ex.account_id }),
      ...(ex.geo_id && { geo_id: ex.geo_id }),
      ...(ex.legal_description && { legalDescription: ex.legal_description }),
      noticeMailingDate: ex.mailing_date,
      noticeProtestDeadline: ex.protest_deadline,
      noticeReceived: true,
      cadName: ex.cad_name,
      noticeValidatedAt: NOW,
      noticeValidationVisionResult: visionResult.result,
    };
    const newMeta = {
      ...(cur?.filing_package_meta || {}),
      notice_validated: {
        validated_at: NOW,
        validation_method: 'vision-extract-pipeline',
        vision_result: visionResult.result,
        confidence: visionResult.confidence,
        extracted: ex,
        notice_storage_path: storagePath,
      },
      blockers: ((cur?.filing_package_meta?.blockers) || []).filter(b => b !== 'MISSING_VALID_NOTICE_OF_APPRAISED_VALUE' && b !== 'MISSING_VALID_NOTICE'),
    };

    // Domain-specific fields (notice_url, property_data, filing_package_meta) — written directly
    // because state-controller handles status/flags/metrics/activity_log only.
    await sb.from('submissions').update({
      notice_url: noticeUrl,
      notice_of_value: storagePath,
      upload_status: 'verified_notice',
      customer_notice_status: 'VALID_NOTICE_RECEIVED',
      customer_notice_confirmed_at: NOW,
      property_data: newPropData,
      filing_package_meta: newMeta,
      ...(ex.assessed_value && { assessed_value: ex.assessed_value }),
    }).eq('case_id', caseId);
    actions.push('db.update(notice_url + property_data + meta)');

    // Status transition via state-controller (single source of truth)
    const scResult = await updateCaseState(caseId, 'notice_uploaded_valid', {
      actor: 'notice-upload-pipeline',
      reason: `Vision-validated NOV: ${visionResult.reason}`,
      details: { vision_confidence: visionResult.confidence, extracted: ex, storage_path: storagePath },
      force: true, // override any prior block lock so valid notice always promotes
      actor_role: 'admin', // system pipeline runs with admin privilege (Phase 7)
      _sb: sb,
    });
    actions.push(`state-controller(notice_uploaded_valid) → ${scResult.applied_status} | log=${scResult.activity_log_id}`);

    console.log(`[notice-pipeline] ${caseId} PASS — assessed=$${ex.assessed_value?.toLocaleString()} | mailing=${ex.mailing_date} | account=${ex.account_id}`);
    return {
      result: 'PASS', confidence: visionResult.confidence, reason,
      extracted: ex, actions_taken: actions,
      next_step: 'build_or_finalize_package',
    };
  }

  // ---------- FAIL / INDETERMINATE path ----------
  // For INDETERMINATE we treat as FAIL but mark differently.
  if (dryRun) return { result: finalResult, confidence: visionResult.confidence, reason, extracted: visionResult.extracted, actions_taken: ['DRY-RUN'], next_step: 'await_correct_upload' };

  // Quarantine: copy into evidence/ then remove from notices/
  const filename = path.basename(storagePath);
  const evidencePath = `evidence/${caseId}/${filename}`;

  const { error: upErr } = await sb.storage.from('documents').upload(evidencePath, buf, {
    contentType: 'image/jpeg', upsert: true,
  });
  if (upErr) console.error(`[notice-pipeline] evidence upload error:`, upErr.message);
  else actions.push(`storage.upload(evidence/${caseId}/${filename})`);

  const { error: rmErr } = await sb.storage.from('documents').remove([storagePath]);
  if (rmErr) console.error(`[notice-pipeline] notice remove error:`, rmErr.message);
  else actions.push(`storage.remove(${storagePath})`);

  const evidenceUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/documents/${evidencePath}`;

  // DB update — restore blocker, lock, attach evidence
  const { data: cur } = await sb.from('submissions').select('email,owner_name,filing_package_meta,property_data,manual_status_lock').eq('case_id', caseId).single();
  const newMeta = {
    ...(cur?.filing_package_meta || {}),
    blockers: Array.from(new Set([...(cur?.filing_package_meta?.blockers || []), 'MISSING_VALID_NOTICE_OF_APPRAISED_VALUE'])),
    misfiled_notice_attempts: [
      ...((cur?.filing_package_meta?.misfiled_notice_attempts) || []),
      {
        attempt_at: NOW,
        wrong_doc_subtype: visionResult.doc_subtype,
        vision_reason: visionResult.reason,
        confidence: visionResult.confidence,
        moved_from: storagePath,
        moved_to: evidencePath,
        evidence_url: evidenceUrl,
        validator: 'notice-upload-pipeline',
      },
    ],
  };
  const newPropData = {
    ...(cur?.property_data || {}),
    [`${visionResult.doc_subtype || 'misfiled'}_evidence_url`]: evidenceUrl,
  };

  // Domain-specific fields (quarantine meta, notice cleared) — written directly
  await sb.from('submissions').update({
    notice_url: null,
    notice_file: null,
    notice_of_value: null,
    upload_status: 'invalid_notice_uploaded',
    customer_notice_status: 'INVALID_DOCUMENT',
    filing_package_meta: newMeta,
    property_data: newPropData,
  }).eq('case_id', caseId);
  actions.push('db.update(notice_url cleared + quarantine meta)');

  // Status transition + lock via state-controller (single source of truth)
  const scResult = await updateCaseState(caseId, 'notice_invalid', {
    actor: 'notice-upload-pipeline',
    reason: `Uploaded file rejected: ${reason}`,
    lock_reason: `Customer-uploaded notice failed validation: ${reason}`,
    details: { vision_doc_subtype: visionResult.doc_subtype, missing_fields: fields.missing, moved_to: evidencePath },
    _sb: sb,
  });
  actions.push(`state-controller(notice_invalid) → ${scResult.applied_status} | log=${scResult.activity_log_id}`);

  // Send clarification email if SG client provided + customer has email
  let emailMsgId = null;
  const customerEmail = cur?.email;
  if (sgMail && customerEmail) {
    try {
      const ownerFirst = (cur?.owner_name || 'there').split(' ')[0];
      const subject = 'Correct document needed for your protest';
      const text = `Hi ${ownerFirst},

Thanks for sending that document.

It is helpful, but it is not the official Notice of Appraised Value we need to file your protest.

Please send the letter or PDF from your county appraisal district titled "Notice of Appraised Value" for 2026. It usually shows:
- your account/property ID
- 2026 appraised value
- mailing date
- protest deadline

You can upload a photo or PDF, or reply directly to this email with it attached.

Once we have that notice, we can finish preparing your filing.

Thanks,
OverAssessed`;
      const html = text.split('\n').map(l => l ? `<p style="margin:0 0 10px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#222;">${l.replace(/^- /,'• ')}</p>` : '<br/>').join('\n');
      const [resp] = await sgMail.send({
        to: customerEmail,
        from: { email: 'support@overassessed.ai', name: 'OverAssessed' },
        bcc: team.emails ? team.emails() : [],
        subject, text, html,
        trackingSettings: { clickTracking: { enable: false }, openTracking: { enable: true } },
      });
      emailMsgId = resp?.headers?.['x-message-id'] || null;
      actions.push(`sendgrid.send(${customerEmail}) -> ${resp?.statusCode}`);
    } catch (e) {
      console.error(`[notice-pipeline] email error:`, e.message);
      actions.push('email.error: ' + e.message);
    }
  } else {
    actions.push(sgMail ? 'email.skipped(no customer email on file)' : 'email.skipped(no sgMail client)');
  }

  // Supplemental activity log entry for quarantine details (state-controller already wrote
  // state.notice_invalid entry; this adds the domain-specific quarantine + email detail)
  await sb.from('activity_log').insert({
    case_id: caseId, actor: 'aquabot', action: 'invalid_notice_quarantined',
    details: {
      vision_result: visionResult.result,
      vision_doc_subtype: visionResult.doc_subtype,
      vision_reason: visionResult.reason,
      missing_fields: fields.missing,
      moved_from: storagePath,
      moved_to: evidencePath,
      evidence_url: evidenceUrl,
      clarification_email_sent: !!emailMsgId,
      sendgrid_msg_id: emailMsgId,
      validator: 'notice-upload-pipeline',
    },
  });
  actions.push('activity_log(invalid_notice_quarantined)');

  console.log(`[notice-pipeline] ${caseId} ${finalResult} — quarantined to ${evidencePath}, email sent=${!!emailMsgId}`);
  return {
    result: finalResult, confidence: visionResult.confidence, reason,
    extracted: visionResult.extracted, actions_taken: actions,
    next_step: 'await_correct_upload',
  };
}

module.exports = { processNoticeUpload, classifyAndExtract, hasRequiredFields };
