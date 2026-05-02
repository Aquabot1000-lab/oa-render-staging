// ═════════════════════════════════════════════════════════════════════════
// routes/pipeline-board.js  (Phase 5 — 2026-05-02, Tyler msg 28585)
// ─────────────────────────────────────────────────────────────────────────
// The Pipeline Board — primary operational screen for Tyler + Uri.
//
// GET /api/pipeline-board
//   → Kanban-style grouped view of every active case, bucketed into
//     revenue-priority columns. Read-only. No mutations from this surface.
//
// Column logic is deterministic and based ONLY on canonical flag fields:
//   aoa_signed, notice_received, filing_ready, filing_status,
//   manual_status_lock, status, last_outreach_at, comp_results
//
// Sort within each column: estimated_revenue DESC NULLS LAST, then
// last_activity_at DESC NULLS LAST (recency tie-breaker).
//
// Performance: single SELECT, indexed reads (see migration 009). No N+1.
// All next_action computation is in-memory after the read.
// ═════════════════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../lib/supabase');
const { computeNextAction } = require('../lib/next-action-engine');

// Column ids in display order. UI uses this for left→right rendering.
const COLUMN_ORDER = [
  'needs_outreach',
  'aoa_sent',
  'signed_waiting_nov',
  'ready_for_comps',
  'ready_to_file',
  'filed',
  'blocked',
  'no_opportunity',
];

const COLUMN_META = {
  needs_outreach:     { label: 'Needs Outreach',         icon: '📣', tone: 'warn'  },
  aoa_sent:           { label: 'AOA Sent',               icon: '✉️', tone: 'info'  },
  signed_waiting_nov: { label: 'Signed — Waiting NOV',   icon: '📝', tone: 'info'  },
  ready_for_comps:    { label: 'Ready for Comps',        icon: '🔍', tone: 'info'  },
  ready_to_file:      { label: 'Ready to File',          icon: '🚀', tone: 'good'  },
  filed:              { label: 'Filed',                  icon: '✅', tone: 'good'  },
  blocked:            { label: 'Blocked',                icon: '🔒', tone: 'bad'   },
  no_opportunity:     { label: 'No Opportunity',         icon: '💤', tone: 'muted' },
};

// ── helpers ────────────────────────────────────────────────────────────────
function compsCount(row) {
  const r = row.comp_results;
  if (!r) return 0;
  if (Array.isArray(r)) return r.length;
  if (typeof r === 'object' && r.comps && Array.isArray(r.comps)) return r.comps.length;
  if (typeof r === 'object') return Object.keys(r).length;
  return 0;
}

// ── Status categories ─────────────────────────────────────────────────────
// Statuses that definitively mean "no longer active" or "terminal block".
// workflow locks (e.g. TX wave) are NOT treated as blocked — they are in-flight.
const NO_OPP_STATUSES   = new Set(['NO_OPPORTUNITY','LOST_CONTACT']);
const HARD_BLOCK_STATUS = new Set(['BLOCKED_MISSING_VALID_NOTICE','CAD_BLOCKED','NEEDS_MANUAL_RECOVERY']);
// Statuses where outreach has been sent (flag supplement: last_outreach_at may be null)
const AOA_SENT_STATUSES = new Set(['AOA_REQUEST_SENT','NOV_REQUEST_SENT','WAITING_NOTICE','WAITING_SIGNATURE']);
// Statuses representing filing-ready (flag supplement: filing_ready may be lagged)
const SIGNED_STATUSES   = new Set(['SIGNED_READY_TO_FILE']);

function isFiled(row) {
  const fs = (row.filing_status || '').toUpperCase();
  const s  = (row.status || '').toUpperCase();
  // Use only explicit filing signals — NOT filed_at (can be set on blocked cases)
  return fs === 'FILED' || row.filing_submitted === true || s === 'FILED';
}

function isReadyToFile(row) {
  if (isFiled(row)) return false;
  if (row.filing_ready === true) return true;
  const s  = (row.status || '').toUpperCase();
  const fs = (row.filing_status || '').toUpperCase();
  if (s === 'SIGNED_READY_TO_FILE') return true;
  if (fs === 'READY_TO_FILE_WA' || fs === 'READY' || fs === 'READY_FOR_FILING_ON_NOV') return true;
  return false;
}

function isBlocked(row) {
  const s  = (row.status || '').toUpperCase();
  const fs = (row.filing_status || '').toUpperCase();
  // Hard status blocks
  if (HARD_BLOCK_STATUS.has(s)) return true;
  if (s.startsWith('BLOCKED')) return true;
  if (fs.startsWith('BLOCKED_') || fs === 'BLOCKED_MISSING_NOTICE') return true;
  // manual_status_lock is only a hard-block signal when the status itself is blocked/stuck.
  // Workflow locks on in-flight cases (e.g. AOA_REQUEST_SENT TX wave) are NOT blocked.
  if (row.manual_status_lock === true && HARD_BLOCK_STATUS.has(s)) return true;
  if (row.manual_status_lock === true && s.startsWith('BLOCKED')) return true;
  return false;
}

function isNoOpportunity(row) {
  const s  = (row.status || '').toUpperCase();
  const fs = (row.filing_status || '').toUpperCase();
  if (NO_OPP_STATUSES.has(s)) return true;
  if (fs.startsWith('NO_OPPORTUNITY')) return true;
  return false;
}

// Bucket assignment. ORDER MATTERS — first match wins.
// Terminal states are checked first; in-flight uses flag + status fallback.
function classifyCase(row) {
  if (isNoOpportunity(row)) return 'no_opportunity';
  if (isFiled(row))         return 'filed';
  if (isBlocked(row))       return 'blocked';
  if (isReadyToFile(row))   return 'ready_to_file';

  const aoaSigned      = row.aoa_signed === true;
  const noticeReceived = row.notice_received === true;
  const hasComps       = compsCount(row) > 0;
  const s              = (row.status || '').toUpperCase();
  // Status-based fallback for outreach signal (last_outreach_at may lag)
  const hasOutreach    = !!row.last_outreach_at || AOA_SENT_STATUSES.has(s);

  if (!aoaSigned && !hasOutreach) return 'needs_outreach';
  if (!aoaSigned &&  hasOutreach) return 'aoa_sent';
  if ( aoaSigned && !noticeReceived) return 'signed_waiting_nov';
  if ( aoaSigned &&  noticeReceived && !hasComps) return 'ready_for_comps';
  // signed + notice + comps but not ready_to_file yet (awaiting build/approval)
  return 'ready_for_comps';
}

function toCard(row) {
  const na = (() => {
    try { return computeNextAction(row); } catch { return null; }
  })();
  return {
    case_id: row.case_id,
    owner_name: row.owner_name || '—',
    address: row.property_address || '—',
    county: row.county || null,
    estimated_tax_savings: row.estimated_tax_savings != null ? Number(row.estimated_tax_savings) : null,
    estimated_revenue:     row.estimated_revenue     != null ? Number(row.estimated_revenue)     : null,
    status: row.status || null,
    filing_status: row.filing_status || null,
    next_action: na ? na.action : null,
    next_action_priority: na ? na.priority : null,
    next_action_icon:     na ? na.icon     : null,
    next_action_color:    na ? na.color    : null,
    last_activity_at: row.last_activity_at || row.updated_at || null,
    last_outreach_at: row.last_outreach_at || null,
    flags: {
      aoa_signed: row.aoa_signed === true,
      notice_received: row.notice_received === true,
      filing_ready: row.filing_ready === true,
      manual_status_lock: row.manual_status_lock === true,
      vip: row.vip === true,
    },
  };
}

function sortCards(cards) {
  cards.sort((a, b) => {
    const ra = a.estimated_revenue == null ? -1 : a.estimated_revenue;
    const rb = b.estimated_revenue == null ? -1 : b.estimated_revenue;
    if (rb !== ra) return rb - ra;
    const ta = a.last_activity_at ? new Date(a.last_activity_at).getTime() : 0;
    const tb = b.last_activity_at ? new Date(b.last_activity_at).getTime() : 0;
    return tb - ta;
  });
  return cards;
}

// ── route ──────────────────────────────────────────────────────────────────
// authenticateToken is applied at mount-time in server.js.
router.get('/', async (req, res) => {
  const t0 = Date.now();
  try {
    // Single indexed SELECT — only the columns we need for classification + cards.
    const FIELDS = [
      'case_id', 'owner_name', 'property_address', 'county',
      'status', 'filing_status', 'filing_ready', 'filing_submitted', 'filed_at',
      'aoa_signed', 'notice_received',
      'manual_status_lock', 'status_lock_reason',
      'estimated_revenue', 'estimated_tax_savings', 'estimated_savings', 'savings',
      'last_activity_at', 'last_outreach_at', 'updated_at',
      'comp_results', 'vip',
      'do_not_contact', 'archived_at',
    ].join(',');

    const { data: rows, error } = await supabaseAdmin
      .from('submissions')
      .select(FIELDS)
      .is('deleted_at', null)
      .is('archived_at', null)
      .order('estimated_revenue', { ascending: false, nullsFirst: false })
      .order('last_activity_at',  { ascending: false, nullsFirst: false })
      .limit(1000);

    if (error) throw error;

    // Init columns
    const columns = {};
    for (const id of COLUMN_ORDER) {
      columns[id] = { id, ...COLUMN_META[id], cards: [] };
    }

    // Classify + enrich
    for (const row of rows || []) {
      const colId = classifyCase(row);
      if (!columns[colId]) continue;
      columns[colId].cards.push(toCard(row));
    }

    // Sort within each column
    let totalCards = 0;
    let totalRevenue = 0;
    for (const id of COLUMN_ORDER) {
      sortCards(columns[id].cards);
      columns[id].count = columns[id].cards.length;
      columns[id].revenue_sum = columns[id].cards.reduce((s, c) => s + (c.estimated_revenue || 0), 0);
      totalCards += columns[id].count;
      totalRevenue += columns[id].revenue_sum;
    }

    res.json({
      generated_at: new Date().toISOString(),
      latency_ms: Date.now() - t0,
      total_cases: totalCards,
      total_estimated_revenue: totalRevenue,
      column_order: COLUMN_ORDER,
      columns,
    });
  } catch (e) {
    console.error('[pipeline-board] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Diagnostic: classify a single caseId (handy for debugging "why is OA-XXXX in column Y?")
router.get('/why/:caseId', async (req, res) => {
  try {
    const { data: row, error } = await supabaseAdmin
      .from('submissions').select('*').eq('case_id', req.params.caseId).single();
    if (error || !row) return res.status(404).json({ error: 'case not found' });
    const colId = classifyCase(row);
    res.json({
      case_id: row.case_id,
      column: colId,
      reason: {
        aoa_signed: row.aoa_signed === true,
        notice_received: row.notice_received === true,
        filing_ready: row.filing_ready === true,
        filing_status: row.filing_status || null,
        manual_status_lock: row.manual_status_lock === true,
        status: row.status || null,
        is_filed: isFiled(row),
        is_blocked: isBlocked(row),
        is_no_opportunity: isNoOpportunity(row),
        is_ready_to_file: isReadyToFile(row),
        has_outreach: !!row.last_outreach_at,
        comps_count: compsCount(row),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.classifyCase = classifyCase;
module.exports.COLUMN_ORDER = COLUMN_ORDER;
module.exports.COLUMN_META = COLUMN_META;
