#!/usr/bin/env node
/**
 * scripts/check-state-writes.js
 *
 * CI GUARD — Phase 0.5 Architecture Lockdown (Tyler msg 28321)
 *
 * Scans for direct writes to canonical state/metric fields in submissions
 * that bypass services/state-controller.js.
 *
 * Rules enforced:
 *   1. No .update({...}) on submissions with `status:` key outside approved files
 *   2. No .update({...}) on submissions with `filing_status:` key outside approved files
 *   3. No .update({...}) on submissions with canonical metric fields outside controller/rebuild
 *
 * EXEMPT paths (legacy, scripts, or controller itself):
 *   - scripts/          (one-shot ops, run manually)
 *   - lib/state-engine/ (legacy, deprecated, no new writes should be added)
 *   - services/state-controller.js (IS the controller)
 *   - scripts/_metric-rebuild-preview.js
 *   - migrations/
 *   - archive/
 *   - node_modules/
 *
 * Exit 0 = clean. Exit 1 = violations found (blocks CI).
 *
 * Usage: node scripts/check-state-writes.js [--warn-only]
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const WARN_ONLY = process.argv.includes('--warn-only');
const ROOT      = path.resolve(__dirname, '..');

const EXEMPT_PATTERNS = [
  /[/\\]scripts[/\\]/,
  /[/\\]lib[/\\]state-engine[/\\]/,
  /[/\\]services[/\\]state-controller\.js$/,
  /[/\\]scripts[/\\]_metric-rebuild-preview\.js$/,
  /[/\\]migrations[/\\]/,
  /[/\\]archive[/\\]/,
  /[/\\]node_modules[/\\]/,
  /[/\\]\.git[/\\]/,
];

const STATUS_FIELDS = [
  /\bstatus\s*:/,
  /\bfiling_status\s*:/,
];

const METRIC_FIELDS = [
  /\bestimated_tax_savings\s*:/,
  /\bestimated_revenue\s*:/,
  /\bestimated_reduction_value\s*:/,
  /\bestimated_tax_rate\s*:/,
  /\bcomp_low_anchor_value\s*:/,
  /\bsettlement_estimate_value\s*:/,
  // legacy — allowed as mirror write ONLY inside state-controller
  // /\bestimated_savings\s*:/,
];

const ALL_GUARDED = [...STATUS_FIELDS, ...METRIC_FIELDS];

function* walkFiles(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      yield* walkFiles(full);
    } else if (ent.isFile() && full.endsWith('.js')) {
      yield full;
    }
  }
}

function isExempt(filePath) {
  return EXEMPT_PATTERNS.some(re => re.test(filePath));
}

/**
 * Very lightweight check: find .update( or .upsert( calls that contain a
 * guarded field within 600 chars, and only when the call context appears to
 * target the submissions table.
 */
/**
 * AST-light approach: walk the file and find every `.from('submissions').update({...})`
 * (or .upsert) call, parse out the top-level keys of the object literal passed in,
 * and report any guarded keys.  Brace-counting handles nested JSONB sub-objects.
 */
function checkFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const hits = [];

  // Find all .from('submissions').{update,upsert}({  call sites.
  // Pattern allows whitespace and chained calls; we anchor on the literal table name.
  const callRe = /from\s*\(\s*['"]submissions['"]\s*\)\s*(?:\.\s*\w+\s*\([^)]*\)\s*)*?\.\s*(update|upsert)\s*\(\s*\{/g;

  let m;
  while ((m = callRe.exec(src))) {
    const objStart = m.index + m[0].length; // points just after the opening `{`
    // Walk forward, counting braces, to find the matching `}`. Tracks string
    // literals so braces inside strings don't confuse us.
    let depth = 1;
    let i = objStart;
    let str = null;          // active string char (', ", `) or null
    let escaped = false;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (escaped) { escaped = false; i++; continue; }
      if (str) {
        if (c === '\\') escaped = true;
        else if (c === str) str = null;
      } else {
        if (c === '\'' || c === '"' || c === '`') str = c;
        else if (c === '{') depth++;
        else if (c === '}') depth--;
      }
      i++;
    }
    if (depth !== 0) continue; // unbalanced; skip
    const body = src.slice(objStart, i - 1);

    // Walk top-level keys of body. Only depth-0 `key:` patterns count.
    let d = 0;
    let inStr = null;
    let esc = false;
    let keyStart = 0;
    let atLineStart = true;
    const topKeyLines = []; // {keyName, lineInFile}
    for (let j = 0; j < body.length; j++) {
      const c = body[j];
      if (esc) { esc = false; continue; }
      if (inStr) {
        if (c === '\\') esc = true;
        else if (c === inStr) inStr = null;
        continue;
      }
      if (c === '\'' || c === '"' || c === '`') { inStr = c; continue; }
      if (c === '{' || c === '[' || c === '(') d++;
      else if (c === '}' || c === ']' || c === ')') d--;
      else if (c === ':' && d === 0) {
        // Look back to extract the key name
        let k = j - 1;
        while (k >= 0 && /\s/.test(body[k])) k--;
        let kEnd = k + 1;
        while (k >= 0 && /[A-Za-z0-9_$]/.test(body[k])) k--;
        const key = body.slice(k + 1, kEnd);
        if (key) {
          // line in file = lines before objStart + lines before j in body
          const lineNo = src.slice(0, objStart + j).split('\n').length;
          topKeyLines.push({ key, lineNo });
        }
      }
    }

    const guardedKeys = new Set([
      'status', 'filing_status',
      'estimated_tax_savings', 'estimated_revenue', 'estimated_reduction_value',
      'estimated_tax_rate', 'comp_low_anchor_value', 'settlement_estimate_value',
    ]);
    for (const tk of topKeyLines) {
      if (guardedKeys.has(tk.key)) {
        const lines = src.split('\n');
        hits.push({
          line: tk.lineNo,
          text: lines[tk.lineNo - 1].trim(),
          field: tk.key,
        });
      }
    }
  }

  return hits;
}

// ── Main ─────────────────────────────────────────────────────────────────────

let totalViolations = 0;
const report = [];

for (const filePath of walkFiles(ROOT)) {
  if (isExempt(filePath)) continue;

  let hits;
  try {
    hits = checkFile(filePath);
  } catch (e) {
    console.warn(`[check-state-writes] Could not read ${filePath}: ${e.message}`);
    continue;
  }

  if (hits.length > 0) {
    const rel = path.relative(ROOT, filePath);
    report.push({ file: rel, hits });
    totalViolations += hits.length;
  }
}

if (totalViolations === 0) {
  console.log('✅ check-state-writes: No direct state/metric writes found outside controller.');
  process.exit(0);
}

// Report violations
console.error(`\n🚨 check-state-writes: ${totalViolations} violation(s) found!\n`);
console.error('All status/filing_status/metric writes to submissions must go through');
console.error('services/state-controller.js (updateCaseState or rebuildAllMetrics).\n');

for (const { file, hits } of report) {
  console.error(`  📄 ${file}`);
  for (const h of hits) {
    console.error(`     L${h.line}: ${h.text}`);
  }
}

console.error('\nTo fix: replace direct .update({status:...}) with updateCaseState(case_id, event, payload)');
console.error('See services/state-controller.js EVENT_MAP for available events.\n');

if (WARN_ONLY) {
  console.warn('[check-state-writes] Running in --warn-only mode; not failing CI.');
  process.exit(0);
}

process.exit(1);
