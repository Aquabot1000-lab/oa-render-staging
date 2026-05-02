// ═════════════════════════════════════════════════════════════════════════
// routes/pipeline-priority.js  (Phase 6 — 2026-05-02, Tyler msg 28627)
// ─────────────────────────────────────────────────────────────────────────
// Revenue Activation endpoints.
//
// GET /api/pipeline-priority
//   → Top N cases (default 10) by estimated_revenue DESC.
//     Excludes NO_OPPORTUNITY, LOST_CONTACT, FILED.
//     Each entry: case_id, owner, address, estimated_revenue,
//                 estimated_tax_savings, stage (pipeline column),
//                 next_action, last_activity_at, days_since_last_activity,
//                 high_value, stale_level, cta {action, url, label}.
//
// GET /api/pipeline-priority/today
//   → Today's Focus: top 5 ACTIONABLE revenue cases, filtered to those
//     where Tyler/Uri can take an immediate action (Send AOA, Request NOV,
//     Approve Filing, Review Case). Excludes locked workflow rows where the
//     next move belongs to the customer (e.g. waiting on signature).
//
// Pure read. No mutations. Reuses Phase 5 classifier.
// ═════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../lib/supabase');
const { computeNextAction } = require('../lib/next-action-engine');
const { classifyCase, COLUMN_META } = require('./pipeline-board');

// ── Thresholds (Tyler msg 28627) ─────────────────────────────────────────
const HIGH_VALUE_REV     = 3000;   // estimated_revenue >= 3000 → high-value
const STALE_WARN_DAYS    = 3;      // >3 days → warn
const STALE_CRIT_DAYS    = 7;      // >7 days → critical

// Stages NOT shown on priority list (Tyler spec: exclude NO_OPP/LOST/FILED)
const EXCLUDED_STAGES = new Set(['no_opportunity', 'filed']);

// Stages that map to a clear actor-of-next-step. We only surface in
// "Today's Focus" if the next action is on US, not on the customer or
// on a system process.
const ACTIONABLE_STAGES = new Set([
  'needs_outreach',     // we send AOA
  'ready_for_comps',    // we run comps / build package
  'ready_to_file',      // we approve & file
  'blocked',            // we unblock (review-case CTA)
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

// CTA mapping per stage. Returns { action, label, url } or null when the
// next move belongs to the customer/system (not Tyler/Uri).
function ctaForStage(stageId, row) {
  const caseId = row.case_id;
  const caseUrl = `/case?id=${encodeURIComponent(caseId)}`;

  switch (stageId) {
    case 'needs_outreach':
      return { action: 'send_aoa', label: 'Send AOA', url: caseUrl, primary: true };
    case 'aoa_sent':
      // Waiting on customer — no action surfaced in Today's Focus.
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
  };
}

const SELECT_FIELDS = [
  'case_id', 'owner_name', 'property_address', 'county',
  'status', 'filing_status', 'filing_ready', 'filing_submitted', 'filed_at',
  'aoa_signed', 'notice_received',
  'manual_status_lock', 'status_lock_reason',
  'estimated_revenue', 'estimated_tax_savings', 'estimated_savings', 'savings',
  'last_activity_at', 'last_outreach_at', 'updated_at',
  'comp_results', 'vip',
  'do_not_contact', 'archived_at',
].join(',');

async function fetchActiveCases() {
  const { data, error } = await supabaseAdmin
    .from('submissions')
    .select(SELECT_FIELDS)
    .is('deleted_at', null)
    .is('archived_at', null)
    .order('estimated_revenue', { ascending: false, nullsFirst: false })
    .order('last_activity_at',  { ascending: false, nullsFirst: false })
    .limit(1000);
  if (error) throw error;
  return data || [];
}

// ── GET /api/pipeline-priority ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  const t0 = Date.now();
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const rows = await fetchActiveCases();

    const enriched = [];
    for (const row of rows) {
      const stage = classifyCase(row);
      if (EXCLUDED_STAGES.has(stage)) continue;
      enriched.push(enrich(row, stage));
    }

    // Sort: estimated_revenue DESC NULLS LAST, last_activity_at DESC
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
// Top 5 actionable revenue cases. Filters to stages where the next move is
// on Tyler/Uri (not waiting on customer or system).
router.get('/today', async (req, res) => {
  const t0 = Date.now();
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 5, 20);
    const rows = await fetchActiveCases();

    const enriched = [];
    for (const row of rows) {
      const stage = classifyCase(row);
      if (EXCLUDED_STAGES.has(stage)) continue;
      // Today's Focus = stages where WE act next.
      if (!ACTIONABLE_STAGES.has(stage)) continue;
      enriched.push(enrich(row, stage));
    }

    // Same sort: revenue DESC, then recency DESC.
    // (Stale cases are NOT auto-promoted; revenue still rules. Stale is shown via badge.)
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
module.exports.HIGH_VALUE_REV = HIGH_VALUE_REV;
module.exports.STALE_WARN_DAYS = STALE_WARN_DAYS;
module.exports.STALE_CRIT_DAYS = STALE_CRIT_DAYS;
