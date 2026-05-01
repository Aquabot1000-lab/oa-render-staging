/**
 * services/state-controller.js
 *
 * SINGLE SOURCE OF TRUTH for case state mutations.
 * Authorized: Tyler Worthey msg 28194 (2026-05-01 14:53 CDT).
 *
 * RULES (enforced by code review, not by DB triggers):
 *   - NO script may update submissions table directly.
 *   - ALL state transitions go through updateCaseState(caseId, event, payload).
 *   - Manual locks (manual_status_lock=true) are RESPECTED — the controller will
 *     refuse to overwrite status unless payload.force=true.
 *   - status is NEVER derived in callers; it is set here based on the event.
 *
 * EVENT MAP (Tyler msg 28194):
 *   aoa_request_sent       → status=AOA_REQUEST_SENT
 *   esign_completed        → status=SIGNED_READY_TO_FILE, aoa_signed=true
 *   notice_uploaded_valid  → status=NOTICE_RECEIVED, notice_received=true
 *   notice_invalid         → status=BLOCKED_MISSING_VALID_NOTICE (lock)
 *   package_built          → status=READY_PENDING_NOV or READY_TO_FILE
 *   filed                  → status=FILED, filing_ready=true
 *   lost_contact           → status=LOST_CONTACT
 *
 * Side effects on EVERY call:
 *   1. Writes activity_log row
 *   2. Sets last_activity_at = now()
 *   3. If category is outreach (aoa_request_sent, etc.) sets last_outreach_at
 *   4. Recomputes estimated_savings and estimated_revenue when comps are present
 *   5. Maintains derived flags: aoa_signed, notice_received, filing_ready
 *
 * RETURNS:
 *   {
 *     ok: true | false,
 *     case_id, event,
 *     applied_status: string,
 *     prior_status: string,
 *     locked: boolean,             // true if change was blocked by manual lock
 *     metrics: { estimated_savings, estimated_revenue, comps_count },
 *     flags: { aoa_signed, notice_received, filing_ready },
 *     activity_log_id: number | null,
 *     warnings: string[],
 *   }
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');

// ---------- event → status map ----------

const EVENT_MAP = {
  aoa_request_sent:      { status: 'AOA_REQUEST_SENT',           outreach: true,  category: 'outreach' },
  esign_completed:       { status: 'SIGNED_READY_TO_FILE',       outreach: false, category: 'milestone', sets: { aoa_signed: true, fee_agreement_signed: true, fee_agreement_signed_at: 'NOW' } },
  notice_uploaded_valid: { status: 'NOTICE_RECEIVED',            outreach: false, category: 'milestone', sets: { notice_received: true } },
  notice_invalid:        { status: 'BLOCKED_MISSING_VALID_NOTICE', outreach: false, category: 'block',   lock: true, sets: { notice_received: false } },
  package_built:         { status: 'READY_PENDING_NOV',          outreach: false, category: 'milestone' }, // status overridden if payload.has_valid_notice
  filed:                 { status: 'FILED',                       outreach: false, category: 'milestone', sets: { filing_ready: true } },
  lost_contact:          { status: 'LOST_CONTACT',                outreach: false, category: 'block' },
};

// Statuses that NEVER allow downgrade (terminal/protected). Manual lock can still apply.
const PROTECTED_STATUSES = new Set(['FILED', 'WITHDRAWN', 'CLOSED', 'PROTEST_HEARING_SCHEDULED', 'PROTEST_RESOLVED']);

// Surface-detected column set, populated lazily.
let _columnsCache = null;
async function getColumns(sb) {
  if (_columnsCache) return _columnsCache;
  const { data } = await sb.from('submissions').select('*').limit(1);
  _columnsCache = new Set(Object.keys(data?.[0] || {}));
  return _columnsCache;
}

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

// ---------- metrics: LOWEST-adjusted-comp anchor (Tyler msg 28217 + 28231) ----------
//
// Standardized definitions:
//   estimated_reduction_value = assessed_value - LOWEST adjusted comp value
//   estimated_tax_savings     = estimated_reduction_value * estimated_tax_rate
//   estimated_revenue         = estimated_tax_savings * 0.25  (fee on actual savings)
//
//   comp_low_anchor_value     = LOWEST adjusted comp (the opening anchor)
//   settlement_estimate_value = MEDIAN adjusted comp (internal reference only)
//
// We anchor on the LOWEST defensible comp because that produces the most aggressive
// opening ask in negotiations. The median is retained for internal settlement modeling.

const COUNTY_TAX_RATES = {
  'bexar':     0.0225,
  'harris':    0.0230,
  'travis':    0.0210,
  'fort bend': 0.0250,
  'tarrant':   0.0240,
  'hunt':      0.0225,
  'dallas':    0.0230,
  'collin':    0.0220,
  'denton':    0.0230,
  'williamson':0.0220,
  'kaufman':   0.0235,
  'rockwall':  0.0235,
};
const DEFAULT_TX_TAX_RATE = 0.025;
const FEE_RATE = 0.25;

function median(nums) {
  const arr = nums.filter(n => Number.isFinite(n)).slice().sort((a,b) => a-b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid-1] + arr[mid]) / 2;
}

function getTaxRateForCounty(county) {
  if (!county) return DEFAULT_TX_TAX_RATE;
  const k = String(county).toLowerCase().replace(/ county$/, '').trim();
  return COUNTY_TAX_RATES[k] || DEFAULT_TX_TAX_RATE;
}

function extractCompValues(comps) {
  return (comps || [])
    .map(c => Number(
      c.adjustedValue || c.adjusted_value || c.adjustedSalePrice || c.adjusted_sale_price ||
      c.marketValue   || c._mv             || c.market_value
    ))
    .filter(n => Number.isFinite(n) && n > 1000);
}

/**
 * Recalculate the full Tyler-spec metric bundle (msg 28217) from a submission row.
 * Returns:
 *   {
 *     estimated_reduction_value,  // assessed - lowest comp
 *     estimated_tax_savings,      // reduction * tax_rate
 *     estimated_revenue,          // tax_savings * 0.25
 *     estimated_tax_rate,
 *     comp_low_anchor_value,      // lowest comp
 *     settlement_estimate_value,  // median comp (internal reference)
 *     comps_count, basis
 *   }
 * All numeric fields are null when comps or assessed_value are unusable.
 */
function computeMetrics(row) {
  const out = {
    estimated_reduction_value: null,
    estimated_tax_savings:     null,
    estimated_revenue:         null,
    estimated_tax_rate:        null,
    comp_low_anchor_value:     null,
    settlement_estimate_value: null,
    comps_count:               0,
    basis:                     'no_comps',
  };

  const assessed = Number(row.assessed_value || row.property_data?.assessedValue || 0);
  if (!assessed || assessed < 1000) {
    out.basis = 'no_assessed_value';
    return out;
  }

  let comps = null;
  if (Array.isArray(row.comp_results) && row.comp_results.length) comps = row.comp_results;
  else if (row.comp_results && Array.isArray(row.comp_results.comps)) comps = row.comp_results.comps;
  else if (row.property_data?.comps && Array.isArray(row.property_data.comps)) comps = row.property_data.comps;

  if (!comps || !comps.length) { out.basis = 'no_comps'; return out; }

  const vals = extractCompValues(comps);
  if (!vals.length) {
    out.basis = 'comps_no_values';
    out.comps_count = comps.length;
    return out;
  }

  out.comps_count = vals.length;
  out.comp_low_anchor_value     = Math.min(...vals);
  out.settlement_estimate_value = Math.round(median(vals));

  const reduction = assessed - out.comp_low_anchor_value;
  if (reduction <= 0) {
    out.basis = 'no_reduction_possible';
    return out;
  }

  const county = row.county || row.property_data?.county || null;
  out.estimated_tax_rate        = getTaxRateForCounty(county);
  out.estimated_reduction_value = Math.round(reduction);
  out.estimated_tax_savings     = Math.round(reduction * out.estimated_tax_rate);
  out.estimated_revenue         = Math.round(out.estimated_tax_savings * FEE_RATE);
  out.basis = 'lowest_comp_anchor';

  return out;
}

// ---------- core controller ----------

/**
 * Update a case in response to an event.
 *
 * @param {string} caseId
 * @param {string} event       — see EVENT_MAP
 * @param {object} [payload]   — event-specific data + optional override flags
 *   payload.actor              — who triggered (default 'system')
 *   payload.reason             — human-readable note
 *   payload.details            — any structured detail (merged into activity_log.details)
 *   payload.force              — bypass manual_status_lock
 *   payload.has_valid_notice   — for package_built: true → READY_TO_FILE, false → READY_PENDING_NOV
 *   payload.skip_metrics       — skip metrics recompute (for hot-path callers)
 *   payload.lock_reason        — used when event=notice_invalid or any lock-setting event
 *   payload.skip_status_update — only log + recompute, do not change status
 *   payload.extra_status       — override status (validated against EVENT_MAP — discouraged)
 *
 * @returns {Promise<object>}  see file header for shape
 */
async function updateCaseState(caseId, event, payload = {}) {
  const sb = payload._sb || getSupabase();
  const NOW = new Date().toISOString();
  const warnings = [];
  const result = {
    ok: false,
    case_id: caseId,
    event,
    applied_status: null,
    prior_status: null,
    locked: false,
    metrics: null,
    flags: {},
    activity_log_id: null,
    warnings,
  };

  if (!caseId) throw new Error('updateCaseState: caseId required');
  const def = EVENT_MAP[event];
  if (!def) throw new Error(`updateCaseState: unknown event '${event}'`);

  const cols = await getColumns(sb);

  // 1. Load the current row
  const { data: row, error: rowErr } = await sb
    .from('submissions')
    .select('*')
    .eq('case_id', caseId)
    .single();
  if (rowErr || !row) {
    throw new Error(`updateCaseState: case ${caseId} not found: ${rowErr?.message}`);
  }
  result.prior_status = row.status;

  // 2. Decide target status
  let targetStatus = def.status;
  if (event === 'package_built') {
    targetStatus = payload.has_valid_notice ? 'READY_TO_FILE' : 'READY_PENDING_NOV';
  }
  if (payload.extra_status) {
    targetStatus = payload.extra_status;
    warnings.push(`extra_status override used: ${payload.extra_status}`);
  }

  // 3. Lock + protection checks
  const isLocked = !!row.manual_status_lock && !payload.force;
  const isProtected = PROTECTED_STATUSES.has(row.status) && row.status !== targetStatus && !payload.force;

  let willChangeStatus = !payload.skip_status_update;
  if (willChangeStatus && (isLocked || isProtected)) {
    willChangeStatus = false;
    result.locked = true;
    warnings.push(
      isLocked
        ? `manual_status_lock=true (reason: ${row.status_lock_reason || 'unknown'}) — status NOT changed`
        : `status ${row.status} is PROTECTED — status NOT changed`
    );
  }

  // 4. Build the update patch
  const patch = {};
  if (cols.has('last_activity_at')) patch.last_activity_at = NOW;
  if (def.outreach && cols.has('last_outreach_at')) patch.last_outreach_at = NOW;

  if (willChangeStatus) {
    patch.status = targetStatus;
  }

  // Apply event-specific 'sets'
  if (def.sets) {
    for (const [k, v] of Object.entries(def.sets)) {
      if (!cols.has(k)) { warnings.push(`column ${k} missing — skipped`); continue; }
      patch[k] = v === 'NOW' ? NOW : v;
    }
  }

  // Lock if event requires it
  if (def.lock && !row.manual_status_lock) {
    if (cols.has('manual_status_lock')) patch.manual_status_lock = true;
    if (cols.has('status_lock_reason')) patch.status_lock_reason = payload.lock_reason || `Auto-lock by event=${event}`;
    if (cols.has('status_locked_at')) patch.status_locked_at = NOW;
    if (cols.has('status_locked_by')) patch.status_locked_by = payload.actor || 'state-controller';
  }

  // Maintain derived flags from current row state (NOT just from event)
  // — these get recomputed from authoritative inputs to self-heal drift.
  const flags = {
    aoa_signed: !!(row.fee_agreement_signed || (def.sets && def.sets.aoa_signed)),
    notice_received: !!(
      (row.upload_status === 'verified_notice') ||
      (row.notice_url && !['wrong_document', 'invalid_notice_uploaded'].includes(row.upload_status))
    ),
    filing_ready: !!(targetStatus === 'FILED' || row.filing_status === 'FILED' || row.filing_ready),
  };
  if (event === 'notice_invalid') flags.notice_received = false;
  if (event === 'notice_uploaded_valid') flags.notice_received = true;
  if (event === 'esign_completed') flags.aoa_signed = true;
  if (event === 'filed') flags.filing_ready = true;

  if (cols.has('aoa_signed'))      patch.aoa_signed = flags.aoa_signed;
  if (cols.has('notice_received')) patch.notice_received = flags.notice_received;
  if (cols.has('filing_ready'))    patch.filing_ready = flags.filing_ready;
  result.flags = flags;

  // 5. Metrics recompute
  let metrics = null;
  if (!payload.skip_metrics) {
    metrics = computeMetrics(row);
    // Only write metrics when comps are present and produced a real result.
    // Never overwrite a valid existing figure with null.
    if (metrics.comps_count > 0 && metrics.estimated_savings != null) {
      patch.estimated_savings = metrics.estimated_savings;
    }
    if (cols.has('estimated_revenue') && metrics.comps_count > 0 && metrics.estimated_revenue != null) {
      patch.estimated_revenue = metrics.estimated_revenue;
    }
  }
  result.metrics = metrics;
  if (metrics) {
    result.estimated_tax_savings     = metrics.estimated_tax_savings;
    result.estimated_revenue         = metrics.estimated_revenue;
    result.estimated_reduction_value = metrics.estimated_reduction_value;
  }

  // 6. Apply patch (one atomic update)
  if (Object.keys(patch).length) {
    const { error: updErr } = await sb.from('submissions').update(patch).eq('case_id', caseId);
    if (updErr) {
      throw new Error(`updateCaseState: update failed for ${caseId}: ${updErr.message}`);
    }
  }

  result.applied_status = patch.status || row.status;

  // 7. Activity log — ALWAYS, even if locked (audit trail)
  const logRow = {
    case_id: caseId,
    actor: payload.actor || 'system',
    action: `state.${event}`,
    details: {
      event,
      prior_status: result.prior_status,
      applied_status: result.applied_status,
      locked: result.locked,
      patch_keys: Object.keys(patch),
      flags: result.flags,
      metrics: result.metrics,
      reason: payload.reason || null,
      ...(payload.details || {}),
    },
    created_at: NOW,
  };
  const { data: logIns, error: logErr } = await sb.from('activity_log').insert(logRow).select('id').single();
  if (logErr) {
    warnings.push(`activity_log insert failed: ${logErr.message}`);
  } else {
    result.activity_log_id = logIns?.id;
  }

  result.ok = true;
  console.log(`[state-controller] ${caseId} ${event} → ${result.applied_status}${result.locked ? ' (LOCKED, status unchanged)' : ''} | savings=${result.metrics?.estimated_savings ?? '—'} | comps=${result.metrics?.comps_count ?? 0}`);
  return result;
}

// ---------- nightly drift correction ----------

/**
 * Sweep every submission and recompute metrics + derived flags.
 * Does NOT change `status` — only metrics and flags.  Designed to be run by cron.
 */
async function rebuildAllMetrics(opts = {}) {
  const sb = opts._sb || getSupabase();
  const cols = await getColumns(sb);

  const stats = { scanned: 0, updated: 0, errors: 0, skipped_locked: 0 };
  let from = 0;
  const PAGE = 200;

  while (true) {
    const { data: page, error } = await sb
      .from('submissions')
      .select('case_id,status,county,assessed_value,property_data,comp_results,fee_agreement_signed,upload_status,notice_url,filing_status,filing_ready,manual_status_lock,estimated_savings,estimated_revenue,estimated_tax_savings,estimated_reduction_value,comp_low_anchor_value')
      .order('case_id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`rebuildAllMetrics: ${error.message}`);
    if (!page || !page.length) break;

    for (const row of page) {
      stats.scanned++;
      try {
        const metrics = computeMetrics(row);
        const aoa_signed      = !!row.fee_agreement_signed;
        const notice_received = !!(
          (row.upload_status === 'verified_notice') ||
          (row.notice_url && !['wrong_document','invalid_notice_uploaded'].includes(row.upload_status))
        );
        const filing_ready    = !!(row.filing_status === 'FILED' || row.status === 'FILED' || row.filing_ready);

        const patch = {};
        // Only update savings/revenue if comps exist and produced a result.
        // Do NOT overwrite comp-engine-generated numbers when comps returned nothing new.
        if (metrics.comps_count > 0 && metrics.estimated_savings != null && metrics.estimated_savings !== row.estimated_savings) {
          patch.estimated_savings = metrics.estimated_savings;
        }
        if (cols.has('estimated_revenue') && metrics.comps_count > 0 && metrics.estimated_revenue != null && metrics.estimated_revenue !== row.estimated_revenue) {
          patch.estimated_revenue = metrics.estimated_revenue;
        }
        if (cols.has('aoa_signed'))      patch.aoa_signed = aoa_signed;
        if (cols.has('notice_received')) patch.notice_received = notice_received;
        if (cols.has('filing_ready'))    patch.filing_ready = filing_ready;

        if (Object.keys(patch).length) {
          const { error: uErr } = await sb.from('submissions').update(patch).eq('case_id', row.case_id);
          if (uErr) { stats.errors++; console.error(`[rebuildAllMetrics] ${row.case_id} ${uErr.message}`); }
          else      { stats.updated++; }
        }
      } catch (e) {
        stats.errors++;
        console.error(`[rebuildAllMetrics] ${row.case_id} ${e.message}`);
      }
    }

    if (page.length < PAGE) break;
    from += PAGE;
  }

  console.log(`[rebuildAllMetrics] scanned=${stats.scanned} updated=${stats.updated} errors=${stats.errors}`);
  return stats;
}

module.exports = {
  updateCaseState,
  rebuildAllMetrics,
  computeMetrics,
  EVENT_MAP,
  PROTECTED_STATUSES,
};
