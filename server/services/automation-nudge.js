/**
 * services/automation-nudge.js
 *
 * Phase 8 — Auto-Nudges (Tyler msg 28665)
 *
 * INTERNAL ALERTS ONLY — never sends customer-facing messages.
 * No auto-filing, no direct DB writes — everything through updateCaseState().
 *
 * Exports: runNudgeScan(supabaseAdmin, opts)
 *   opts.sendTelegramAlert — from server-notifications.js
 *   opts.dryRun            — if true, skip state mutations + Telegram sends
 *
 * Returns: { scanned, fired, skipped_idempotent, escalations }
 *
 * Four triggers (all idempotent, 24h cooldown via automation_flags timestamps):
 *   1. AOA not sent within 24h         — stage=needs_outreach, age > 24h
 *   2. AOA sent but not signed in 3d   — stage=aoa_sent, last_outreach_at > 3d ago
 *   3. READY_TO_FILE idle 48h          — stage=ready_to_file, last_activity_at > 48h
 *   4. High-value + stale              — estimated_revenue >= 3000, stale_level in (warning,critical)
 *
 * Trigger #4 escalations send Telegram (capped at 5/run).
 * Triggers #1-3 roll into next Daily Command (no per-nudge Telegram spam).
 */

'use strict';

const { updateCaseState, getColumns } = require('./state-controller');
const { classifyCase } = require('../routes/pipeline-board');

const TWENTY_FOUR_H = 24 * 60 * 60 * 1000;
const THREE_DAYS    = 3  * 24 * 60 * 60 * 1000;
const FORTY_EIGHT_H = 48 * 60 * 60 * 1000;

const HIGH_VALUE_REV  = 3000;
const STALE_WARN_DAYS = 3;
const STALE_CRIT_DAYS = 7;

function daysSince(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

function staleLevel(days) {
  if (days == null) return null;
  if (days > STALE_CRIT_DAYS) return 'critical';
  if (days > STALE_WARN_DAYS) return 'warning';
  return 'fresh';
}

/**
 * Check if the automation_flags timestamp for `key` was set within the last 24h.
 * Returns true (should skip) if set today, false (should fire) if absent or older.
 */
function isIdempotentSkip(flags, key) {
  if (!flags || !flags[key]) return false;
  const t = new Date(flags[key]).getTime();
  if (!Number.isFinite(t)) return false;
  return (Date.now() - t) < TWENTY_FOUR_H;
}

/**
 * Fetch all active, non-filed, non-archived submissions for nudge evaluation.
 * Includes automation_flags when column exists (graceful fallback if not).
 */
async function fetchCasesForScan(sb) {
  const cols = await getColumns(sb).catch(() => new Set());
  const fields = [
    'case_id', 'owner_name', 'status', 'filing_status', 'filing_ready',
    'filing_submitted', 'filed_at', 'aoa_signed', 'notice_received',
    'manual_status_lock', 'last_activity_at', 'last_outreach_at',
    'updated_at', 'created_at', 'comp_results', 'estimated_revenue',
    'do_not_contact', 'archived_at', 'deleted_at',
    ...(cols.has('automation_flags') ? ['automation_flags'] : []),
  ];

  const { data, error } = await sb
    .from('submissions')
    .select(fields.join(','))
    .is('deleted_at', null)
    .is('archived_at', null)
    .limit(2000);

  if (error) throw error;
  return { rows: data || [], hasAutoFlags: cols.has('automation_flags') };
}

/**
 * Main nudge scan entry point.
 *
 * @param {Object} supabaseAdmin — Supabase admin client
 * @param {{ sendTelegramAlert?: Function, dryRun?: boolean }} opts
 * @returns {Promise<{ scanned: number, fired: number, skipped_idempotent: number, escalations: number }>}
 */
async function runNudgeScan(supabaseAdmin, opts = {}) {
  const dryRun = opts.dryRun === true;
  const sendTelegramAlert = opts.sendTelegramAlert;
  const NOW = Date.now();

  console.log(`[NudgeScan] Starting scan${dryRun ? ' [DRY RUN]' : ''}...`);

  const stats = { scanned: 0, fired: 0, skipped_idempotent: 0, escalations: 0 };

  let rows, hasAutoFlags;
  try {
    ({ rows, hasAutoFlags } = await fetchCasesForScan(supabaseAdmin));
  } catch (err) {
    console.error('[NudgeScan] Failed to fetch cases:', err.message);
    return stats;
  }

  if (!hasAutoFlags) {
    console.warn('[NudgeScan] automation_flags column not yet present (migration 010 not run). ' +
      'Nudge writes will be skipped; escalation Telegrams still sent.');
  }

  const escalationQueue = [];

  for (const row of rows) {
    stats.scanned++;
    if (row.do_not_contact) continue;

    let stage;
    try {
      stage = classifyCase(row);
    } catch (err) {
      console.warn(`[NudgeScan] classifyCase failed for ${row.case_id}:`, err.message);
      continue;
    }

    const af = row.automation_flags || {};
    const rev = Number(row.estimated_revenue) || 0;
    const lastAt = row.last_activity_at || row.updated_at || null;
    const days = daysSince(lastAt);
    const sl = staleLevel(days);

    // ── Trigger 1: AOA not sent within 24h ──────────────────────────────
    if (stage === 'needs_outreach') {
      const caseAge = row.created_at ? NOW - new Date(row.created_at).getTime() : 0;
      if (caseAge > TWENTY_FOUR_H) {
        if (isIdempotentSkip(af, 'action_overdue_at')) {
          stats.skipped_idempotent++;
        } else {
          stats.fired++;
          if (!dryRun) {
            try {
              await updateCaseState(row.case_id, 'automation_nudge', {
                _sb: supabaseAdmin,
                actor: 'system',
                reason: 'AOA not sent within 24h of case creation',
                details: { trigger: 'aoa_not_sent_24h', stage, case_age_h: Math.round(caseAge / 3600000) },
                flag_updates: hasAutoFlags ? { action_overdue_at: new Date().toISOString() } : undefined,
                skip_metrics: true,
              });
            } catch (err) {
              console.error(`[NudgeScan] T1 updateCaseState failed for ${row.case_id}:`, err.message);
            }
          } else {
            console.log(`[NudgeScan] [DRY RUN] T1 AOA-not-sent-24h: ${row.case_id}`);
          }
        }
      }
    }

    // ── Trigger 2: AOA sent but not signed in 3 days ─────────────────────
    if (stage === 'aoa_sent' && row.aoa_signed !== true) {
      const outreachAt = row.last_outreach_at || row.updated_at;
      const outreachAge = outreachAt ? NOW - new Date(outreachAt).getTime() : 0;
      if (outreachAge > THREE_DAYS) {
        if (isIdempotentSkip(af, 'auto_followup_sent_at')) {
          stats.skipped_idempotent++;
        } else {
          stats.fired++;
          if (!dryRun) {
            try {
              await updateCaseState(row.case_id, 'automation_nudge', {
                _sb: supabaseAdmin,
                actor: 'system',
                reason: 'AOA sent but not signed in 3+ days',
                details: {
                  trigger: 'aoa_not_signed_3d',
                  stage,
                  outreach_age_d: Math.round(outreachAge / 86400000),
                },
                flag_updates: hasAutoFlags ? { auto_followup_sent_at: new Date().toISOString() } : undefined,
                skip_metrics: true,
              });
            } catch (err) {
              console.error(`[NudgeScan] T2 updateCaseState failed for ${row.case_id}:`, err.message);
            }
          } else {
            console.log(`[NudgeScan] [DRY RUN] T2 AOA-not-signed-3d: ${row.case_id}`);
          }
        }
      }
    }

    // ── Trigger 3: READY_TO_FILE idle 48h ────────────────────────────────
    if (stage === 'ready_to_file') {
      const idleMs = lastAt ? NOW - new Date(lastAt).getTime() : 0;
      if (idleMs > FORTY_EIGHT_H) {
        if (isIdempotentSkip(af, 'action_overdue_at')) {
          stats.skipped_idempotent++;
        } else {
          stats.fired++;
          if (!dryRun) {
            try {
              await updateCaseState(row.case_id, 'automation_nudge', {
                _sb: supabaseAdmin,
                actor: 'system',
                reason: 'READY_TO_FILE case idle for 48h+',
                details: { trigger: 'ready_to_file_idle_48h', stage, idle_h: Math.round(idleMs / 3600000) },
                flag_updates: hasAutoFlags ? { action_overdue_at: new Date().toISOString() } : undefined,
                skip_metrics: true,
              });
            } catch (err) {
              console.error(`[NudgeScan] T3 updateCaseState failed for ${row.case_id}:`, err.message);
            }
          } else {
            console.log(`[NudgeScan] [DRY RUN] T3 ready-to-file-idle-48h: ${row.case_id}`);
          }
        }
      }
    }

    // ── Trigger 4: High-value + stale → escalate ─────────────────────────
    if (rev >= HIGH_VALUE_REV && (sl === 'warning' || sl === 'critical')) {
      if (isIdempotentSkip(af, 'escalated_at')) {
        stats.skipped_idempotent++;
      } else {
        // Queue escalation (capped at 5 per run below)
        escalationQueue.push({ row, stage, rev, days, sl });
        stats.fired++;
        if (!dryRun) {
          try {
            await updateCaseState(row.case_id, 'automation_nudge', {
              _sb: supabaseAdmin,
              actor: 'system',
              reason: `High-value case (${rev}) stale for ${days}d (${sl})`,
              details: { trigger: 'high_value_stale', stage, estimated_revenue: rev, stale_level: sl, days },
              flag_updates: hasAutoFlags ? { escalated_at: new Date().toISOString() } : undefined,
              skip_metrics: true,
            });
          } catch (err) {
            console.error(`[NudgeScan] T4 updateCaseState failed for ${row.case_id}:`, err.message);
          }
        } else {
          console.log(`[NudgeScan] [DRY RUN] T4 escalate: ${row.case_id} (${sl}, ${days}d, $${rev})`);
        }
      }
    }
  }

  // ── Send escalation Telegrams (capped at 5) ───────────────────────────────
  const toEscalate = escalationQueue.slice(0, 5);
  stats.escalations = toEscalate.length;

  if (toEscalate.length > 0 && typeof sendTelegramAlert === 'function') {
    for (const { row, rev, days } of toEscalate) {
      const msg = `🔥 ESCALATED — ${row.case_id} ${row.owner_name || '(unknown)'} — $${Math.round(rev).toLocaleString('en-US')} — high-value stale ${days}d`;
      if (!dryRun) {
        try {
          await sendTelegramAlert(msg);
        } catch (err) {
          console.error('[NudgeScan] Telegram escalation error:', err.message);
        }
      } else {
        console.log('[NudgeScan] [DRY RUN] Escalation Telegram:', msg);
      }
    }
    if (escalationQueue.length > 5) {
      const overflow = `[NudgeScan] Escalation cap hit — ${escalationQueue.length - 5} additional cases suppressed this run`;
      console.warn(overflow);
    }
  }

  console.log(`[NudgeScan] Done — scanned=${stats.scanned} fired=${stats.fired} skipped_idempotent=${stats.skipped_idempotent} escalations=${stats.escalations}`);
  return stats;
}

module.exports = { runNudgeScan };
