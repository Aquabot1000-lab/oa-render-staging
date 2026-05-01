/**
 * notifications.test.js — regression suite for detectState()
 *
 * Run: node server/services/notifications.test.js
 * (Plain assert; no test runner required.)
 *
 * Background: Bug 2026-05-01. Lead OA-0100 (Paul Car) signed up via
 * /lp/denver-county.html (which hardcodes state:'CO', county:'Denver') with
 * a Texas address: "6613 Glenhope Cir North, Colleyville TX 76034".
 *
 * Old detectState() regex didn't recognize "Colleyville" as a TX city, so
 * address-derived state came back null and the function fell through to
 * the explicit state=CO from the landing page form. Lead got parked as
 * "Out of TX service area" with state=CO, county=denver.
 *
 * Old detectState() also had substring false positives:
 *   - "Denver Ave, Houston TX" → CO (matched 'denver' in street)
 *   - "Aurora, TX" → CO (matched 'aurora' though Aurora TX is real)
 *   - "Boulder Creek Pkwy, Austin TX" → CO
 *
 * Fix: detectState() now defers to services/address-parser.js parseAddress(),
 * which uses proper trailing-state detection + ZIP map + comprehensive
 * city→county tables. This file pins the behavior.
 */

'use strict';

const assert = require('assert');
const { detectState } = require('./notifications');

let pass = 0, fail = 0;
function check(label, actual, expected) {
    try {
        assert.strictEqual(actual, expected, `${label}: expected ${expected}, got ${actual}`);
        console.log(`  ✅ ${label}`);
        pass++;
    } catch (e) {
        console.log(`  ❌ ${label}: ${e.message}`);
        fail++;
    }
}

console.log('\n=== detectState() regression suite ===\n');

// ── REGRESSION: Paul Car / OA-0100 ───────────────────────────────────────────
console.log('Paul Car (OA-0100) — TX address on CO landing page:');
check(
    'Colleyville TX 76034 with explicit CO from landing page',
    detectState('organic-co-denver', 'Denver', 'CO', '6613 Glenhope Cir North, Colleyville TX 76034'),
    'TX'
);
check(
    'Same address, comma-separated',
    detectState('organic-co-denver', 'Denver', 'CO', '6613 Glenhope Cir North, Colleyville, TX 76034'),
    'TX'
);

// ── REGRESSION: substring false positives (street names) ─────────────────────
console.log('\nSubstring false positives (must NOT trigger CO):');
check(
    '"Denver Ave, Houston TX" — denver in street name',
    detectState('website-intake', null, null, '1234 Denver Ave, Houston, TX 77002'),
    'TX'
);
check(
    '"Boulder Creek Pkwy, Austin TX"',
    detectState('website-intake', null, null, '123 Boulder Creek Pkwy, Austin, TX 78745'),
    'TX'
);
check(
    '"Aspen Trail, Frisco TX"',
    detectState('website-intake', null, null, '5500 Aspen Trail, Frisco, TX 75033'),
    'TX'
);

// ── REGRESSION: ambiguous city name (Aurora exists in TX and CO) ─────────────
console.log('\nAmbiguous city (Aurora exists in both TX and CO):');
check(
    'Aurora, TX with ZIP 76078',
    detectState('website-intake', null, null, '123 Main St, Aurora, TX 76078'),
    'TX'
);
check(
    'Aurora, CO with ZIP 80014',
    detectState('website-intake', null, null, '123 Main St, Aurora, CO 80014'),
    'CO'
);

// ── Real Colorado addresses still work ───────────────────────────────────────
console.log('\nReal CO addresses still detect CO:');
check(
    'Denver, CO with ZIP',
    detectState('organic-co-denver', 'Denver', null, '5300 S Federal Blvd, Denver, CO 80123'),
    'CO'
);
check(
    'Boulder, CO with ZIP',
    detectState('organic-co-boulder', 'Boulder', null, '900 Pearl St, Boulder, CO 80302'),
    'CO'
);
check(
    'Aspen, CO with ZIP',
    detectState('website-intake', null, null, '320 E Main St, Aspen, CO 81611'),
    'CO'
);

// ── Other supported states still work ────────────────────────────────────────
console.log('\nOther supported states:');
check(
    'Atlanta, GA',
    detectState('website-intake', null, null, '100 Peachtree St NW, Atlanta, GA 30303'),
    'GA'
);
check(
    'Seattle, WA',
    detectState('website-intake', null, null, '400 Broad St, Seattle, WA 98109'),
    'WA'
);
check(
    'Phoenix, AZ',
    detectState('website-intake', null, null, '1 N Central Ave, Phoenix, AZ 85004'),
    'AZ'
);

// ── Form-explicit state used when address has no signal (fallback path) ──────
console.log('\nFallback to explicit state when address has no signal:');
check(
    'No address state info, form says CO',
    detectState('website-intake', null, 'CO', '123 Main St'),
    'CO'
);

// ── Final tally ──────────────────────────────────────────────────────────────
console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
