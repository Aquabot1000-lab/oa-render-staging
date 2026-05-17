// ═════════════════════════════════════════════════════════════════════════
// routes/pipeline-priority.js  (Phase 8 — 2026-05-02, Tyler msg 28665)
// ─────────────────────────────────────────────────────────────────────────
// Revenue Activation endpoints.
//
// GET /api/pipeline-priority
//   → Top N cases (default 10) by estimated_revenue DESC.
//
// GET /api/pipeline-priority/today
//   → Today's Focus: top 5 ACTIONABLE revenue cases.
//
// Phase 8 additions:
//   - buildTodayFocus({ sb, limit }) — exported for daily-task-loop.js
//   - buildPriorityList({ sb, limit }) — exported for future use
//   - automation_followup / automation_overdue / automation_escalated booleans on each card
//   - automation_flags included in SELECT when column is available (graceful fallback)
// ═════════════════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../lib/supabase');
const { computeNextAction } = require('../lib/next-action-engine');
const { classifyCase, COLUMN_META } = require('./pipeline-board');
const { getColumns } = require('../services/state-controller');
const { classifyFilingWindow, ctaForWindow } = require('../lib/filing-window');

// ── Thresholds (Tyler msg 28627) ─────────────────────────────────────────
const HIGH_VALUE_REV     = 3000;   // estimated_revenue >= 3000 → high-value
const STALE_WARN_DAYS    = 3;      // >3 days → warn
const STALE_CRIT_DAYS    = 7;      // >7 days → critical
const SEVEN_DAYS_MS      = 7 * 86400000;

const EXCLUDED_STAGES = new Set(['no_opportunity', 'filed']);

const ACTIONABLE_STAGES = new Set([
  'needs_outreach',
  'ready_for_comps',
  'ready_to_file',
  'blocked',
]);

// ── helpers ────────────────────────────────────────────────────────────────
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

function ctaForStage(stageId, row) {
  const caseId = row.case_id;
  const caseUrl = `/case?id=${encodeURIComponent(caseId)}`;

  switch (stageId) {
    case 'needs_outreach':
      return { action: 'send_aoa', label: 'Send AOA', url: caseUrl, primary: true };
    case 'aoa_sent':
      return { action: 'review_case', label: 'Review Case', url: caseUrl, primary: false };
    case 'signed_waiting_nov':
      return { action: 'request_nov', label: 'Request NOV', url: caseUrl, primary: true };
    case 'ready_for_comps':
      return { action: 'review_case', label: 'Run Comps', url: caseUrl, primary: true };
    case 'ready_to_file':
      return { action: 'approve_filing', label: 'Approve Filing', url: caseUrl, primary: true };
    case 'blocked':
      return { action: 'review_case', label: 'Review Case', url: caseUrl, primary: true };
    default:
      return { action: 'review_case', label: 'Review Case', url: caseUrl, primary: false };
  }
}

// Returns automation badge booleans from automation_flags jsonb.
// A flag is "active" when the timestamp exists and is within the window.
function automationBooleans(row) {
  const af = row.automation_flags || {};
  const now = Date.now();
  const recent = (key, windowMs) => {
    if (!af[key]) return false;
    const t = new Date(af[key]).getTime();
    return Number.isFinite(t) && (now - t) < (windowMs || SEVEN_DAYS_MS);
  };
  // Phase 9: auto_message_sent — truthy if last_auto_outreach_at within 14 days
  const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
  return {
    automation_followup:  recent('auto_followup_sent_at'),
    automation_overdue:   recent('action_overdue_at'),
    automation_escalated: recent('escalated_at'),
    auto_message_sent:    recent('last_auto_outreach_at', FOURTEEN_DAYS_MS),
    auto_outreach_count:  Number(af.auto_outreach_count) || 0,
  };
}

function enrich(row, stageId) {
  const lastAt = row.last_activity_at || row.updated_at || null;
  const days = daysSince(lastAt);
  const rev = row.estimated_revenue != null ? Number(row.estimated_revenue) : null;
  const sav = row.estimated_tax_savings != null ? Number(row.estimated_tax_savings) : null;
  const stageLabel = COLUMN_META[stageId]?.label || stageId;

  let na = null;
  try { na = computeNextAction(row); } catch { na = null; }

  return {
    case_id: row.case_id,
    owner_name: row.owner_name || '—',
    address: row.property_address || '—',
    county: row.county || null,
    stage: stageId,
    stage_label: stageLabel,
    status: row.status || null,
    filing_status: row.filing_status || null,
    estimated_revenue: rev,
    estimated_tax_savings: sav,
    high_value: rev != null && rev >= HIGH_VALUE_REV,
    last_activity_at: lastAt,
    days_since_last_activity: days,
    stale_level: staleLevel(days),
    next_action: na?.action || null,
    next_action_icon: na?.icon || null,
    next_action_priority: na?.priority || null,
    flags: {
      aoa_signed: row.aoa_signed === true,
      notice_received: row.notice_received === true,
      filing_ready: row.filing_ready === true,
      manual_status_lock: row.manual_status_lock === true,
      vip: row.vip === true,
    },
    cta: ctaForStage(stageId, row),
    // Phase 8: automation badge booleans
    ...automationBooleans(row),
    // Raw data fields needed for highlights + filing-window classification
    _raw: {
      created_at: row.created_at || null,
      aoa_signed: row.aoa_signed === true,
      filing_ready: row.filing_ready === true,
      filing_submitted: row.filing_submitted === true,
      state: row.state || null,
      county: row.county || null,
      assessed_value: row.assessed_value || null,
      tags: Array.isArray(row.tags) ? row.tags : [],
      automation_flags: row.automation_flags || null,
      filing_status: row.filing_status || null,
    },
  };
}

const SELECT_FIELDS_BASE = [
  'case_id', 'owner_name', 'property_address', 'county', 'state',
  'status', 'filing_status', 'filing_ready', 'filing_submitted', 'filed_at',
  'aoa_signed', 'notice_received',
  'manual_status_lock', 'status_lock_reason',
  'estimated_revenue', 'estimated_tax_savings', 'estimated_savings', 'savings',
  'assessed_value', 'tags',
  'last_activity_at', 'last_outreach_at', 'updated_at', 'created_at',
  'comp_results', 'vip',
  'do_not_contact', 'archived_at',
];

// Fetch all active cases using provided sb client (or default supabaseAdmin).
// Includes automation_flags if the column is available.
async function fetchActiveCases(sb) {
  const sbClient = sb || supabaseAdmin;
  const cols = await getColumns(sbClient).catch(() => new Set());
  const fields = [...SELECT_FIELDS_BASE];
  if (cols.has('automation_flags')) fields.push('automation_flags');

  const { data, error } = await sbClient
    .from('submissions')
    .select(fields.join(','))
    .is('deleted_at', null)
    .is('archived_at', null)
    .order('estimated_revenue', { ascending: false, nullsFirst: false })
    .order('last_activity_at',  { ascending: false, nullsFirst: false })
    .limit(1000);
  if (error) throw error;
  return data || [];
}

// ── Shared data-building helpers (exported for daily-task-loop.js) ─────────

/**
 * Build the full priority list (all active, non-excluded cases, sorted by revenue).
 * @param {{ sb?: object, limit?: number }} opts
 */
async function buildPriorityList({ sb, limit = 10 } = {}) {
  const rows = await fetchActiveCases(sb);
  const enriched = [];
  for (const row of rows) {
    const stage = classifyCase(row);
    if (EXCLUDED_STAGES.has(stage)) continue;
    enriched.push(enrich(row, stage));
  }

  enriched.sort((a, b) => {
    const ra = a.estimated_revenue == null ? -1 : a.estimated_revenue;
    const rb = b.estimated_revenue == null ? -1 : b.estimated_revenue;
    if (rb !== ra) return rb - ra;
    const ta = a.last_activity_at ? new Date(a.last_activity_at).getTime() : 0;
    const tb = b.last_activity_at ? new Date(b.last_activity_at).getTime() : 0;
    return tb - ta;
  });

  const top = enriched.slice(0, limit);
  const totalRev = top.reduce((s, c) => s + (c.estimated_revenue || 0), 0);
  return { top, totalRev, all: enriched };
}

/**
 * Build Today's Focus: actionable cases + highlights for Daily Command digest.
 * @param {{ sb?: object, limit?: number }} opts
 * @returns {{
 *   top: object[],        // top actionable cases (up to limit)
 *   totalRev: number,     // total revenue of ALL actionable cases
 *   highlights: {
 *     highValueStale: object[],      // >$5k, >3d untouched
 *     readyToFileBlocked: object[],  // ready_to_file + aoa_signed=true + filing_ready=false
 *     aoaNotSent24h: object[],       // needs_outreach + case age >24h
 *   }
 * }}
 */
async function buildTodayFocus({ sb, limit = 5 } = {}) {
  const rows = await fetchActiveCases(sb);
  const NOW = Date.now();

  const enriched = [];
  for (const row of rows) {
    const stage = classifyCase(row);
    if (EXCLUDED_STAGES.has(stage)) continue;
    const card = enrich(row, stage);
    enriched.push(card);
  }

  enriched.sort((a, b) => {
    const ra = a.estimated_revenue == null ? -1 : a.estimated_revenue;
    const rb = b.estimated_revenue == null ? -1 : b.estimated_revenue;
    if (rb !== ra) return rb - ra;
    const ta = a.last_activity_at ? new Date(a.last_activity_at).getTime() : 0;
    const tb = b.last_activity_at ? new Date(b.last_activity_at).getTime() : 0;
    return tb - ta;
  });

  // ── Filing window classification (Tyler msg 34806) ── [MOVED BEFORE top slice]
  // Tag every enriched card with its window class so the top-N list reflects
  // the corrected CTA (e.g. "Late Remedy Review" instead of "Send AOA" for
  // closed-window cases) and so highlight buckets render correctly.
  for (const c of enriched) {
    c.filing_window = classifyFilingWindow(c._raw);
    if (c.filing_window && c.filing_window !== 'UNKNOWN' && c.filing_window !== 'ACTIVE_FILING_WINDOW') {
      const replacement = ctaForWindow(c.filing_window, c.cta?.label);
      c.cta = { ...(c.cta || {}), label: replacement.label, action: replacement.action, window_note: replacement.note };
      c.next_action = replacement.label;
    }
  }

  const actionable = enriched.filter(c => ACTIONABLE_STAGES.has(c.stage));
  const top = actionable.slice(0, limit);
  const totalRev = actionable.reduce((s, c) => s + (c.estimated_revenue || 0), 0);

  // Highlights
  const highValueStale = enriched.filter(c =>
    (c.estimated_revenue || 0) > 5000 &&
    (c.days_since_last_activity || 0) > 3
  );

  const readyToFileBlocked = enriched.filter(c =>
    c.stage === 'ready_to_file' &&
    c._raw.aoa_signed === true &&
    c._raw.filing_ready !== true
  );

  // Only count AOA-not-sent for ACTIVE window cases — closed windows route to other tracks.
  const aoaNotSent24h = enriched.filter(c => {
    if (c.stage !== 'needs_outreach') return false;
    if (c.filing_window !== 'ACTIVE_FILING_WINDOW') return false;
    const created = c._raw.created_at;
    if (!created) return false;
    return NOW - new Date(created).getTime() > 86400000;
  });

  // New highlight buckets for closed-window cases.
  const lateRemedyReview = enriched.filter(c => c.filing_window === 'LATE_REMEDY_REVIEW');
  const missedStandardDeadline = enriched.filter(c => c.filing_window === 'MISSED_STANDARD_DEADLINE');
  const candidates2027 = enriched.filter(c => c.filing_window === '2027_CANDIDATE');

  return {
    top,
    totalRev,
    highlights: {
      highValueStale,
      readyToFileBlocked,
      aoaNotSent24h,
      lateRemedyReview,
      missedStandardDeadline,
      candidates2027,
    },
  };
}

// ── GET /api/pipeline-priority ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  const t0 = Date.now();
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const { top, totalRev } = await buildPriorityList({ limit });

    res.json({
      generated_at: new Date().toISOString(),
      latency_ms: Date.now() - t0,
      thresholds: { high_value_revenue: HIGH_VALUE_REV, stale_warn_days: STALE_WARN_DAYS, stale_crit_days: STALE_CRIT_DAYS },
      excluded_stages: [...EXCLUDED_STAGES],
      count: top.length,
      total_revenue: totalRev,
      cases: top,
    });
  } catch (e) {
    console.error('[pipeline-priority] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/pipeline-priority/today ──────────────────────────────────────
router.get('/today', async (req, res) => {
  const t0 = Date.now();
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 5, 20);
    const { top, totalRev } = await buildTodayFocus({ limit });

    const staleCrit = top.filter(c => c.stale_level === 'critical').length;
    const staleWarn = top.filter(c => c.stale_level === 'warning').length;

    res.json({
      generated_at: new Date().toISOString(),
      latency_ms: Date.now() - t0,
      thresholds: { high_value_revenue: HIGH_VALUE_REV, stale_warn_days: STALE_WARN_DAYS, stale_crit_days: STALE_CRIT_DAYS },
      count: top.length,
      total_revenue: totalRev,
      stale_critical_count: staleCrit,
      stale_warning_count: staleWarn,
      cases: top,
    });
  } catch (e) {
    console.error('[pipeline-priority/today] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.HIGH_VALUE_REV  = HIGH_VALUE_REV;
module.exports.STALE_WARN_DAYS = STALE_WARN_DAYS;
module.exports.STALE_CRIT_DAYS = STALE_CRIT_DAYS;
module.exports.buildTodayFocus    = buildTodayFocus;
module.exports.buildPriorityList  = buildPriorityList;
module.exports.automationBooleans = automationBooleans;
