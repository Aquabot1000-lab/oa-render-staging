/**
 * services/auto-outreach.js
 *
 * Phase 9 — Controlled Auto-Outreach (Tyler msg 28669)
 *
 * Two-flow auto nurture for leads who haven't signed the AOA yet:
 *   Flow A: AOA NOT SENT     (stage='needs_outreach')   → Touch 1 at Day 1
 *   Flow B: AOA SENT/UNSIGNED (stage='aoa_sent')        → Touch 2 at Day 3, Touch 3 at Day 5
 *
 * INTERNAL ONLY. Triggered by automation-nudge.js every 30 min.
 * Kill switch: AUTO_OUTREACH_ENABLED must be literally "true" to run.
 * Dry run:    AUTO_OUTREACH_DRY_RUN must be literally "false" to send real messages.
 *
 * Exports:
 *   runAutoOutreach({ supabaseAdmin, dryRun, sendSMS, sendNotificationEmail })
 *   → Promise<{ scanned, eligible, sent, skipped: {reason:count}, dryRun } | { disabled:true }>
 */

'use strict';

const { updateCaseState, getColumns } = require('./state-controller');
const { classifyCase } = require('../routes/pipeline-board');

// ── Constants ─────────────────────────────────────────────────────────────────
const ONE_H  = 60 * 60 * 1000;
const DAY_1  = 24  * ONE_H;  // Touch 1 trigger: 24h after intake
const DAY_3  = 72  * ONE_H;  // Touch 2 trigger: 72h since last outreach
const DAY_5  = 120 * ONE_H;  // Touch 3 trigger: 120h since last outreach
const COOLDOWN_H = 24 * ONE_H;  // min gap between any two auto touches on same case

const SKIP_STATUSES = new Set(['NO_OPPORTUNITY', 'FILED', 'LOST_CONTACT', 'ARCHIVED']);
const MAX_TOUCHES = 3;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract first-name from owner_name, fallback to "there". */
function firstName(ownerName) {
  if (!ownerName) return 'there';
  const tok = ownerName.trim().split(/\s+/)[0];
  return tok || 'there';
}

/** Build SMS + email content for a given touch number. */
function buildMessages(touchNum, row) {
  const name = firstName(row.owner_name);
  const link = `https://overassessed.ai/sign?case=${row.case_id}`;

  switch (touchNum) {
    case 1:
      return {
        smsBody:      `Hey ${name}, we found a potential property tax overassessment on your home. Want me to send you the quick agreement so we can fight it? — Tyler\n${link}\nReply STOP to opt out.`,
        emailSubject: 'Quick question about your property taxes',
        emailBody:    `<p>Hey ${name},</p><p>We found a potential property tax overassessment on your home. Want me to send you the quick agreement so we can fight it? — Tyler</p><p><a href="${link}" style="display:inline-block;padding:10px 20px;background:#1e40af;color:#fff;text-decoration:none;border-radius:6px;">Review &amp; Sign Agreement →</a></p><p style="font-size:12px;color:#6b7280;">Reply STOP to opt out of SMS messages.</p>`,
      };
    case 2:
      return {
        smsBody:      `Hey ${name}, just checking — do you want us to move forward on lowering your property taxes this year? Takes 2 mins to sign: ${link}. Reply STOP to opt out.`,
        emailSubject: 'Still want us to file your protest?',
        emailBody:    `<p>Hey ${name},</p><p>Just checking — do you want us to move forward on lowering your property taxes this year? Takes 2 mins to sign.</p><p><a href="${link}" style="display:inline-block;padding:10px 20px;background:#1e40af;color:#fff;text-decoration:none;border-radius:6px;">Sign Agreement →</a></p><p style="font-size:12px;color:#6b7280;">Reply STOP to opt out of SMS messages.</p>`,
      };
    case 3:
      return {
        smsBody:      `Last call — we can still file your protest but the deadline is coming up. Want me to lock this in for you? ${link} Reply STOP to opt out.`,
        emailSubject: 'Last chance — protest deadline approaching',
        emailBody:    `<p>Hey ${name},</p><p>Last call — we can still file your protest but the deadline is coming up. Want me to lock this in for you?</p><p><a href="${link}" style="display:inline-block;padding:10px 20px;background:#dc2626;color:#fff;text-decoration:none;border-radius:6px;">Sign Before Deadline →</a></p><p style="font-size:12px;color:#6b7280;">Reply STOP to opt out of SMS messages.</p>`,
      };
    default:
      return null;
  }
}

/**
 * Determine which touch number (1–3) a case is eligible for, or null if none.
 *
 * Touch 1: stage='needs_outreach', age >= 24h
 * Touch 2: stage='aoa_sent', since last_outreach >= 72h
 * Touch 3: stage='aoa_sent', since last_outreach >= 120h, total touches < 3
 *
 * Returns touch number (1, 2, or 3), or null.
 */
function determineTouchNumber(row, stage, af, now) {
  const existingTouches = Array.isArray(af.auto_touches) ? af.auto_touches : [];

  if (stage === 'needs_outreach') {
    const ageMs = row.created_at ? now - new Date(row.created_at).getTime() : 0;
    if (ageMs >= DAY_1 && !existingTouches.includes(1)) return 1;
    return null;
  }

  if (stage === 'aoa_sent') {
    const anchor = row.last_outreach_at || row.updated_at;
    const sinceMs = anchor ? now - new Date(anchor).getTime() : 0;

    // Touch 3 (Day 5) has priority check over Touch 2 (Day 3) — pick highest eligible
    if (sinceMs >= DAY_5 && !existingTouches.includes(3)) return 3;
    if (sinceMs >= DAY_3 && !existingTouches.includes(2)) return 2;
    return null;
  }

  return null;
}

/**
 * Fetch candidates for auto-outreach.
 * Returns rows with: case_id, owner_name, status, phone, email, sms_unusable,
 * email_unusable, do_not_contact, automation_excluded, fee_agreement_signed,
 * state, created_at, last_outreach_at, updated_at, automation_flags,
 * aoa_signed, archived_at, deleted_at.
 */
async function fetchCandidates(sb, hasAutoFlags) {
  const fields = [
    'case_id', 'owner_name', 'status', 'phone', 'email',
    'sms_unusable', 'email_unusable', 'do_not_contact', 'automation_excluded',
    'fee_agreement_signed', 'aoa_signed', 'state',
    'created_at', 'last_outreach_at', 'updated_at',
    'archived_at', 'deleted_at',
    // Fields needed for classifyCase
    'filing_status', 'filing_ready', 'filing_submitted', 'filed_at',
    'notice_received', 'manual_status_lock',
    ...(hasAutoFlags ? ['automation_flags'] : []),
  ];

  const { data, error } = await sb
    .from('submissions')
    .select(fields.join(','))
    .is('deleted_at', null)
    .is('archived_at', null)
    .not('status', 'in', `(${[...SKIP_STATUSES].join(',')})`)
    .limit(2000);

  if (error) throw error;
  return data || [];
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run a single auto-outreach scan pass.
 *
 * @param {Object} opts
 * @param {Object} opts.supabaseAdmin    — Supabase admin client
 * @param {boolean} opts.dryRun          — if true, only log; no sends/writes
 * @param {Function} opts.sendSMS        — from server.js
 * @param {Function} opts.sendNotificationEmail — from server.js
 * @returns {Promise<Object>}
 */
async function runAutoOutreach({ supabaseAdmin, dryRun, sendSMS, sendNotificationEmail }) {
  // Kill switch
  if (process.env.AUTO_OUTREACH_ENABLED !== 'true') {
    console.log('[AutoOutreach] disabled=true (AUTO_OUTREACH_ENABLED not set to "true")');
    return { disabled: true };
  }

  // Dry run: default true; must explicitly set AUTO_OUTREACH_DRY_RUN=false to send real messages
  const effectiveDryRun = dryRun !== false
    ? true
    : (process.env.AUTO_OUTREACH_DRY_RUN !== 'false');

  console.log(`[AutoOutreach] Starting scan dryRun=${effectiveDryRun}...`);

  const stats = {
    scanned: 0,
    eligible: 0,
    sent: 0,
    skipped: {},
    dryRun: effectiveDryRun,
  };

  function skip(reason) {
    stats.skipped[reason] = (stats.skipped[reason] || 0) + 1;
  }

  let hasAutoFlags = false;
  try {
    const cols = await getColumns(supabaseAdmin).catch(() => new Set());
    hasAutoFlags = cols.has('automation_flags');
  } catch (_) {
    // safe fallback
  }

  let rows;
  try {
    rows = await fetchCandidates(supabaseAdmin, hasAutoFlags);
  } catch (err) {
    console.error('[AutoOutreach] Failed to fetch candidates:', err.message);
    return stats;
  }

  const now = Date.now();

  for (const row of rows) {
    stats.scanned++;

    // ── Safety filters ──────────────────────────────────────────────────────
    if (row.do_not_contact)       { skip('do_not_contact'); continue; }
    if (row.automation_excluded)  { skip('automation_excluded'); continue; }
    if (row.fee_agreement_signed) { skip('already_signed'); continue; }

    // TX state filter (null treated as TX)
    const state = (row.state || 'TX').toUpperCase();
    if (state !== 'TX') { skip('out_of_tx'); continue; }

    // Status guard (belt-and-suspenders — DB query already filters but graceful fallback)
    if (SKIP_STATUSES.has(row.status)) { skip('skip_status'); continue; }

    // Channel check
    const hasSMS   = !!(row.phone && row.sms_unusable !== true);
    const hasEmail = !!(row.email && row.email_unusable !== true);
    if (!hasSMS && !hasEmail) { skip('no_valid_channel'); continue; }

    // Classify stage
    let stage;
    try {
      stage = classifyCase(row);
    } catch (err) {
      console.warn(`[AutoOutreach] classifyCase failed for ${row.case_id}:`, err.message);
      skip('classify_error');
      continue;
    }

    if (stage !== 'needs_outreach' && stage !== 'aoa_sent') {
      skip('wrong_stage');
      continue;
    }

    const af = row.automation_flags || {};

    // Count cap
    const touchCount = Number(af.auto_outreach_count) || 0;
    if (touchCount >= MAX_TOUCHES) { skip('max_touches'); continue; }

    // 24h cooldown
    if (af.last_auto_outreach_at) {
      const lastMs = new Date(af.last_auto_outreach_at).getTime();
      if (Number.isFinite(lastMs) && (now - lastMs) < COOLDOWN_H) {
        skip('cooldown');
        continue;
      }
    }

    // Determine which touch
    const touchNum = determineTouchNumber(row, stage, af, now);
    if (!touchNum) { skip('no_touch_due'); continue; }

    // All checks passed
    stats.eligible++;

    const msgs = buildMessages(touchNum, row);
    if (!msgs) { skip('build_error'); continue; }

    const bodyPreview = msgs.smsBody.slice(0, 100);

    if (effectiveDryRun) {
      // ── DRY RUN: log only ───────────────────────────────────────────────
      if (hasSMS) {
        console.log(`[AutoOutreach DRY RUN] would send to ${row.case_id} via sms (touch ${touchNum}): ${bodyPreview}…`);
      }
      if (hasEmail && row.email) {
        console.log(`[AutoOutreach DRY RUN] would send to ${row.case_id} via email (touch ${touchNum}): ${msgs.emailSubject}`);
      }
      continue;
    }

    // ── LIVE SEND ─────────────────────────────────────────────────────────
    let anySent = false;
    const nowIso = new Date().toISOString();

    // SMS
    if (hasSMS) {
      try {
        const result = await sendSMS(row.phone, msgs.smsBody);
        if (result && result.success !== false) {
          anySent = true;
          // Insert communications row
          try {
            await supabaseAdmin.from('communications').insert({
              case_id: row.case_id,
              direction: 'outbound',
              channel: 'sms',
              recipient: row.phone,
              body: msgs.smsBody,
              status: 'sent',
            });
          } catch (dbErr) {
            console.error(`[AutoOutreach] communications SMS insert failed for ${row.case_id}:`, dbErr.message);
          }
        } else {
          console.warn(`[AutoOutreach] SMS send failed for ${row.case_id}:`, result?.errorCode);
        }
      } catch (err) {
        console.error(`[AutoOutreach] sendSMS error for ${row.case_id}:`, err.message);
      }
    }

    // Email (parallel; only for cases with real email signup)
    if (hasEmail && row.email) {
      try {
        await sendNotificationEmail(msgs.emailSubject, msgs.emailBody, row.email);
        anySent = true;
        // Insert communications row
        try {
          await supabaseAdmin.from('communications').insert({
            case_id: row.case_id,
            direction: 'outbound',
            channel: 'email',
            recipient: row.email,
            subject: msgs.emailSubject,
            body: msgs.emailBody,
            status: 'sent',
          });
        } catch (dbErr) {
          console.error(`[AutoOutreach] communications email insert failed for ${row.case_id}:`, dbErr.message);
        }
      } catch (err) {
        console.error(`[AutoOutreach] sendNotificationEmail error for ${row.case_id}:`, err.message);
      }
    }

    if (!anySent) {
      skip('send_failed');
      continue;
    }

    stats.sent++;

    // ── Update automation_flags + activity_log ────────────────────────────
    // Compute full new flags (shallow merge won't stack arrays correctly)
    const existingTouches = Array.isArray(af.auto_touches) ? af.auto_touches : [];
    const newFlagUpdates = {
      auto_outreach_count: touchCount + 1,
      auto_touches: [...existingTouches, touchNum],
      last_auto_outreach_at: nowIso,
      last_auto_touch_number: touchNum,
    };

    try {
      await updateCaseState(row.case_id, 'message_sent_auto', {
        _sb: supabaseAdmin,
        actor: 'system:auto-outreach',
        flag_updates: hasAutoFlags ? newFlagUpdates : undefined,
        details: {
          touch: touchNum,
          channel: hasSMS ? 'sms' : 'email',
          body_preview: bodyPreview,
        },
        skip_metrics: true,
      });
    } catch (err) {
      console.error(`[AutoOutreach] updateCaseState failed for ${row.case_id}:`, err.message);
    }
  }

  console.log(`[AutoOutreach] enabled=true scanned=${stats.scanned} eligible=${stats.eligible} sent=${stats.sent} dryRun=${effectiveDryRun}`);
  return stats;
}

module.exports = { runAutoOutreach };
