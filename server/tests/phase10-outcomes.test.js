/**
 * Phase 10 — Close Tracking + Revenue Attribution
 * Tests for case_won / case_lost outcome events via updateCaseState.
 * Tyler msg 28887 (2026-05-02)
 *
 * Pure unit tests — mocked Supabase, no live DB calls.
 * Run: node server/tests/phase10-outcomes.test.js
 */

'use strict';

const assert = require('assert');

// ─── Reset column cache before each test ─────────────────────────────────────
function resetColumnCache() {
  const key = require.resolve('../services/state-controller');
  delete require.cache[key];
}

// ─── Mock Supabase factory ────────────────────────────────────────────────────
function makeMockSb(mockRow) {
  const captured = { patch: null, logRow: null };

  const FULL_ROW = {
    case_id: null, status: null, assessed_value: null, owner_name: null, county: null,
    manual_status_lock: null, status_lock_reason: null, status_locked_at: null, status_locked_by: null,
    last_activity_at: null, last_outreach_at: null, aoa_signed: null, notice_received: null,
    filing_ready: null, filing_approval_status: null, filing_approved: null,
    fee_agreement_signed: null, upload_status: null, notice_url: null,
    automation_flags: null, auto_outreach_count: null,
    // Phase 10 outcome columns
    outcome_status: null, outcome_date: null, final_value: null, original_value: null,
    tax_savings: null, revenue_collected: null, closed_at: null, closed_by: null,
    outcome: null,
    // misc
    note: null, comp_results: null, case_notes: null,
    ...mockRow,
  };

  function makeQuery(tableName) {
    let _method = null;
    let _data   = null;
    let _limit  = null;

    const q = {
      select() { return q; },
      eq()     { return q; },
      not()    { return q; },
      limit(n) { _limit = n; return q; },
      insert(data) { _method = 'insert'; _data = data; return q; },
      update(data) { _method = 'update'; _data = data; return q; },

      async single() {
        if (tableName === 'submissions' && _method === null) {
          return { data: FULL_ROW, error: null };
        }
        if (tableName === 'activity_log' && _method === 'insert') {
          captured.logRow = _data;
          return { data: { id: 'mock-log-id-' + Date.now() }, error: null };
        }
        return { data: null, error: null };
      },

      then(resolve, reject) {
        let result;
        try {
          if (tableName === 'submissions' && _method === null && _limit) {
            result = { data: [FULL_ROW], error: null };
          } else if (tableName === 'submissions' && _method === 'update') {
            captured.patch = _data;
            result = { data: null, error: null };
          } else if (tableName === 'activity_log' && _method === 'insert') {
            captured.logRow = _data;
            result = { data: [{ id: 'mock-log-id' }], error: null };
          } else {
            result = { data: null, error: null };
          }
        } catch (e) { return reject(e); }
        return resolve(result);
      },
    };
    return q;
  }

  return { from: (t) => makeQuery(t), _captured: captured };
}

// ─── Test harness ─────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
    failed++;
  }
}

async function runAll() {
  console.log('Phase 10 Outcome Tests — Close Tracking + Revenue Attribution');
  console.log('══════════════════════════════════════════════════════════════');

  // ── Test 1a: case_won ────────────────────────────────────────────────────────
  await test('case_won: OA-TEST-WON → CLOSED_WON with correct outcome fields', async () => {
    resetColumnCache();
    const { updateCaseState } = require('../services/state-controller');

    const sb = makeMockSb({
      case_id: 'OA-TEST-WON', status: 'FILED', assessed_value: 340000,
      owner_name: 'Test Owner', county: 'Bexar',
    });

    const result = await updateCaseState('OA-TEST-WON', 'case_won', {
      _sb: sb,
      final_value: 285000, original_value: 340000,
      tax_savings: 1237.50, revenue_collected: 309.38,
      outcome_date: '2026-05-01',
      actor: 'tyler', actor_role: 'admin', force: true,
    });

    assert.strictEqual(result.ok, true, 'result.ok should be true');
    assert.strictEqual(result.applied_status, 'CLOSED_WON',
      `applied_status should be CLOSED_WON, got ${result.applied_status}`);

    const patch = sb._captured.patch;
    assert.ok(patch, 'patch should have been captured');
    assert.strictEqual(patch.outcome_status, 'won',
      `outcome_status should be 'won', got ${patch.outcome_status}`);
    assert.strictEqual(patch.tax_savings, 1237.50,
      `tax_savings should be 1237.50, got ${patch.tax_savings}`);
    assert.strictEqual(patch.revenue_collected, 309.38,
      `revenue_collected should be 309.38, got ${patch.revenue_collected}`);
    assert.ok(patch.closed_at, 'closed_at should be set');
  });

  // ── Test 1b: missing required field throws ───────────────────────────────────
  await test('case_won: omit tax_savings → throws "requires numeric payload fields"', async () => {
    resetColumnCache();
    const { updateCaseState } = require('../services/state-controller');

    const sb = makeMockSb({
      case_id: 'OA-TEST-WON', status: 'FILED', assessed_value: 340000,
      owner_name: 'Test Owner', county: 'Bexar',
    });

    let threw = false;
    try {
      await updateCaseState('OA-TEST-WON', 'case_won', {
        _sb: sb,
        final_value: 285000, original_value: 340000,
        // tax_savings intentionally omitted
        revenue_collected: 309.38,
        outcome_date: '2026-05-01',
        actor: 'tyler', actor_role: 'admin', force: true,
      });
    } catch (e) {
      threw = true;
      assert.ok(
        e.message.includes('requires numeric payload fields'),
        `Error should mention 'requires numeric payload fields', got: ${e.message}`
      );
    }
    assert.ok(threw, 'Should have thrown for missing tax_savings');
  });

  // ── Test 2: case_lost ────────────────────────────────────────────────────────
  await test('case_lost: OA-TEST-LOST → CLOSED_LOST with zero savings/revenue', async () => {
    resetColumnCache();
    const { updateCaseState } = require('../services/state-controller');

    const sb = makeMockSb({
      case_id: 'OA-TEST-LOST', status: 'FILED', assessed_value: 340000,
    });

    const result = await updateCaseState('OA-TEST-LOST', 'case_lost', {
      _sb: sb,
      final_value: 340000, original_value: 340000,
      tax_savings: 0, revenue_collected: 0,
      outcome_date: '2026-05-01',
      actor: 'tyler', actor_role: 'admin', force: true,
    });

    assert.strictEqual(result.ok, true, 'result.ok should be true');
    assert.strictEqual(result.applied_status, 'CLOSED_LOST',
      `applied_status should be CLOSED_LOST, got ${result.applied_status}`);

    const patch = sb._captured.patch;
    assert.ok(patch, 'patch should have been captured');
    assert.strictEqual(patch.outcome_status, 'lost',
      `outcome_status should be 'lost', got ${patch.outcome_status}`);
    assert.strictEqual(patch.tax_savings, 0,
      `tax_savings should be 0, got ${patch.tax_savings}`);
    assert.strictEqual(patch.revenue_collected, 0,
      `revenue_collected should be 0, got ${patch.revenue_collected}`);
    assert.ok(patch.closed_at, 'closed_at should be set');
  });

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('');
  console.log(`Passed: ${passed}   Failed: ${failed}`);
  console.log('');
  if (failed > 0) {
    console.log('❌ PHASE 10 TESTS FAILED');
    process.exit(1);
  } else {
    console.log('✅ All Phase 10 tests passed — Close Tracking + Revenue Attribution verified');
    process.exit(0);
  }
}

runAll().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
