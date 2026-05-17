/**
 * services/daily-task-loop.js
 *
 * Phase 8 — Daily Command (Tyler msg 28665)
 * Replaces legacy task digest with buildTodayFocus()-driven digest.
 * Runs at 8 AM CDT and 2 PM CDT.
 *
 * Digest includes:
 *   - Top 5 actionable cases (case_id, owner, $revenue, next_action / cta label)
 *   - Total actionable revenue
 *   - Highlights:
 *       • Any case > $5k not touched in 3+ days
 *       • Any READY_TO_FILE not approved (aoa_signed=true, filing_ready=false)
 *       • Any AOA not sent within 24h (stage=needs_outreach, age > 24h)
 *
 * sendNotificationEmail is used for email (no-ops silently if NOTIFY_EMAIL not set).
 * dryRun: true → builds digest but does NOT send Telegram or email; prints to console only.
 */

'use strict';

const { buildTodayFocus } = require('../routes/pipeline-priority');

// sendNotificationEmail is imported lazily to avoid circular deps at module load.
// We accept it as a parameter from server.js via runDailyTaskLoop.

/**
 * Formats a dollar amount, e.g. 12500 → "$12,500"
 */
function fmtMoney(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return '$' + Math.round(n).toLocaleString('en-US');
}

/**
 * Build the Daily Command digest text (Telegram HTML + plain email HTML).
 *
 * @param {{ top, totalRev, highlights }} focus — result from buildTodayFocus()
 * @param {string} label — "AM" | "PM"
 * @returns {{ telegram: string, emailSubject: string, emailHtml: string }}
 */
function buildDigest(focus, label) {
  const { top, totalRev, highlights } = focus;
  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    timeZone: 'America/Chicago',
  });

  // ── Telegram message (HTML parse_mode) ──
  let tg = `📊 <b>OverAssessed Daily Command — ${date} ${label}</b>\n\n`;
  tg += `<b>💰 Top ${top.length} Actionable Cases</b> | Total: ${fmtMoney(totalRev)}\n`;

  if (top.length === 0) {
    tg += '  (no actionable cases right now)\n';
  } else {
    top.forEach((c, i) => {
      const ctaLabel = c.cta?.label || c.next_action || 'Review';
      tg += `  ${i + 1}. <b>${c.case_id}</b> [${c.owner_name}] — ${fmtMoney(c.estimated_revenue)} — ${ctaLabel}\n`;
    });
  }

  // Highlights
  const {
    highValueStale,
    readyToFileBlocked,
    aoaNotSent24h,
    lateRemedyReview = [],
    missedStandardDeadline = [],
    candidates2027 = [],
  } = highlights;

  tg += '\n<b>🔍 Highlights</b>\n';

  if (highValueStale.length) {
    tg += `⚠️ <b>High-value stale (${highValueStale.length})</b> — &gt;$5k, not touched 3+ days:\n`;
    highValueStale.slice(0, 5).forEach(c => {
      tg += `  • ${c.case_id} [${c.owner_name}] — ${fmtMoney(c.estimated_revenue)} — ${c.days_since_last_activity}d idle\n`;
    });
    if (highValueStale.length > 5) tg += `  (+ ${highValueStale.length - 5} more)\n`;
  } else {
    tg += '✅ High-value stale: none\n';
  }

  if (readyToFileBlocked.length) {
    tg += `🚀 <b>READY_TO_FILE not approved (${readyToFileBlocked.length})</b>:\n`;
    readyToFileBlocked.slice(0, 5).forEach(c => {
      tg += `  • ${c.case_id} [${c.owner_name}] — ${fmtMoney(c.estimated_revenue)}\n`;
    });
    if (readyToFileBlocked.length > 5) tg += `  (+ ${readyToFileBlocked.length - 5} more)\n`;
  } else {
    tg += '✅ READY_TO_FILE blocked: none\n';
  }

  if (aoaNotSent24h.length) {
    tg += `⏰ <b>AOA not sent &gt;24h — ACTIVE WINDOW (${aoaNotSent24h.length})</b>:\n`;
    aoaNotSent24h.slice(0, 5).forEach(c => {
      tg += `  • ${c.case_id} [${c.owner_name}] — ${fmtMoney(c.estimated_revenue)}\n`;
    });
    if (aoaNotSent24h.length > 5) tg += `  (+ ${aoaNotSent24h.length - 5} more)\n`;
  } else {
    tg += '✅ AOA overdue (active window): none\n';
  }

  if (lateRemedyReview.length) {
    tg += `🔎 <b>Late Remedy Review (${lateRemedyReview.length})</b> — §25.25 / no-notice / certified-roll:\n`;
    lateRemedyReview.slice(0, 5).forEach(c => {
      tg += `  • ${c.case_id} [${c.owner_name}] — ${fmtMoney(c.estimated_revenue)}\n`;
    });
    if (lateRemedyReview.length > 5) tg += `  (+ ${lateRemedyReview.length - 5} more)\n`;
  }

  if (missedStandardDeadline.length) {
    tg += `⏳ <b>Missed Standard Deadline (${missedStandardDeadline.length})</b> — late follow-up + 2027 track:\n`;
    missedStandardDeadline.slice(0, 5).forEach(c => {
      tg += `  • ${c.case_id} [${c.owner_name}] — ${fmtMoney(c.estimated_revenue)}\n`;
    });
    if (missedStandardDeadline.length > 5) tg += `  (+ ${missedStandardDeadline.length - 5} more)\n`;
  }

  if (candidates2027.length) {
    tg += `📅 <b>2027 Candidates (${candidates2027.length})</b> — monitor for parcel split / next-cycle:\n`;
    candidates2027.slice(0, 5).forEach(c => {
      tg += `  • ${c.case_id} [${c.owner_name}]\n`;
    });
    if (candidates2027.length > 5) tg += `  (+ ${candidates2027.length - 5} more)\n`;
  }

  // ── Email subject + HTML body ──
  const emailSubject = `📊 OverAssessed Daily Command — ${date} ${label}`;

  // Simple text-safe HTML for email
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let emailHtml = `<h2>📊 OverAssessed Daily Command — ${esc(date)} ${esc(label)}</h2>`;
  emailHtml += `<h3>💰 Top ${top.length} Actionable Cases — Total: ${esc(fmtMoney(totalRev))}</h3>`;
  if (top.length === 0) {
    emailHtml += '<p><em>No actionable cases right now.</em></p>';
  } else {
    emailHtml += '<ol>';
    top.forEach(c => {
      const ctaLabel = c.cta?.label || c.next_action || 'Review';
      emailHtml += `<li><strong>${esc(c.case_id)}</strong> [${esc(c.owner_name)}] — ${esc(fmtMoney(c.estimated_revenue))} — ${esc(ctaLabel)}</li>`;
    });
    emailHtml += '</ol>';
  }

  emailHtml += '<h3>🔍 Highlights</h3><ul>';

  if (highValueStale.length) {
    emailHtml += `<li>⚠️ <strong>High-value stale (${highValueStale.length})</strong> — &gt;$5k, not touched 3+ days<ul>`;
    highValueStale.slice(0, 5).forEach(c => {
      emailHtml += `<li>${esc(c.case_id)} [${esc(c.owner_name)}] — ${esc(fmtMoney(c.estimated_revenue))} — ${c.days_since_last_activity}d idle</li>`;
    });
    emailHtml += '</ul></li>';
  } else {
    emailHtml += '<li>✅ High-value stale: none</li>';
  }

  if (readyToFileBlocked.length) {
    emailHtml += `<li>🚀 <strong>READY_TO_FILE not approved (${readyToFileBlocked.length})</strong><ul>`;
    readyToFileBlocked.slice(0, 5).forEach(c => {
      emailHtml += `<li>${esc(c.case_id)} [${esc(c.owner_name)}] — ${esc(fmtMoney(c.estimated_revenue))}</li>`;
    });
    emailHtml += '</ul></li>';
  } else {
    emailHtml += '<li>✅ READY_TO_FILE blocked: none</li>';
  }

  if (aoaNotSent24h.length) {
    emailHtml += `<li>⏰ <strong>AOA not sent &gt;24h — ACTIVE WINDOW (${aoaNotSent24h.length})</strong><ul>`;
    aoaNotSent24h.slice(0, 5).forEach(c => {
      emailHtml += `<li>${esc(c.case_id)} [${esc(c.owner_name)}] — ${esc(fmtMoney(c.estimated_revenue))}</li>`;
    });
    emailHtml += '</ul></li>';
  } else {
    emailHtml += '<li>✅ AOA overdue (active window): none</li>';
  }

  if (lateRemedyReview.length) {
    emailHtml += `<li>🔎 <strong>Late Remedy Review (${lateRemedyReview.length})</strong> — §25.25 / no-notice / certified-roll<ul>`;
    lateRemedyReview.slice(0, 5).forEach(c => {
      emailHtml += `<li>${esc(c.case_id)} [${esc(c.owner_name)}] — ${esc(fmtMoney(c.estimated_revenue))}</li>`;
    });
    emailHtml += '</ul></li>';
  }

  if (missedStandardDeadline.length) {
    emailHtml += `<li>⏳ <strong>Missed Standard Deadline (${missedStandardDeadline.length})</strong> — late follow-up + 2027 track<ul>`;
    missedStandardDeadline.slice(0, 5).forEach(c => {
      emailHtml += `<li>${esc(c.case_id)} [${esc(c.owner_name)}] — ${esc(fmtMoney(c.estimated_revenue))}</li>`;
    });
    emailHtml += '</ul></li>';
  }

  if (candidates2027.length) {
    emailHtml += `<li>📅 <strong>2027 Candidates (${candidates2027.length})</strong> — monitor parcel split / next cycle<ul>`;
    candidates2027.slice(0, 5).forEach(c => {
      emailHtml += `<li>${esc(c.case_id)} [${esc(c.owner_name)}]</li>`;
    });
    emailHtml += '</ul></li>';
  }

  emailHtml += '</ul>';

  return { telegram: tg, emailSubject, emailHtml };
}

/**
 * Run the Daily Command digest.
 *
 * @param {Object} supabaseAdmin — Supabase admin client
 * @param {Function} sendTelegramAlert — from server-notifications.js
 * @param {{ dryRun?: boolean, label?: string, sendNotificationEmail?: Function }} opts
 * @returns {Promise<{ cases_reviewed: number, digest_sent: boolean }>}
 */
async function runDailyTaskLoop(supabaseAdmin, sendTelegramAlert, opts = {}) {
  const dryRun = opts.dryRun === true;
  // Determine AM/PM label from current CDT time
  const hourCDT = new Date().toLocaleString('en-US', {
    hour: 'numeric', hour12: false, timeZone: 'America/Chicago',
  });
  const label = opts.label || (Number(hourCDT) < 13 ? 'AM' : 'PM');

  console.log(`[DailyTaskLoop] Starting Daily Command (${label})${dryRun ? ' [DRY RUN]' : ''}...`);

  try {
    const focus = await buildTodayFocus({ sb: supabaseAdmin, limit: 5 });
    const { telegram: tgText, emailSubject, emailHtml } = buildDigest(focus, label);

    if (dryRun) {
      console.log('[DailyTaskLoop] [DRY RUN] Digest text:\n', tgText);
      return { cases_reviewed: focus.top.length, digest_sent: false, dry_run: true };
    }

    // Send Telegram
    if (typeof sendTelegramAlert === 'function') {
      await sendTelegramAlert(tgText).catch(err =>
        console.error('[DailyTaskLoop] Telegram error:', err.message)
      );
      console.log(`[DailyTaskLoop] Telegram digest sent — ${focus.top.length} focus cases`);
    } else {
      console.warn('[DailyTaskLoop] sendTelegramAlert not available');
    }

    // Send email (no-op if sendNotificationEmail not provided or NOTIFY_EMAIL not set)
    if (typeof opts.sendNotificationEmail === 'function') {
      await opts.sendNotificationEmail({ subject: emailSubject, html: emailHtml }).catch(err =>
        console.error('[DailyTaskLoop] Email error:', err.message)
      );
    }

    return { cases_reviewed: focus.top.length, digest_sent: true };
  } catch (err) {
    console.error('[DailyTaskLoop] Exception:', err);
    return { cases_reviewed: 0, digest_sent: false, error: err.message };
  }
}

module.exports = { runDailyTaskLoop };
