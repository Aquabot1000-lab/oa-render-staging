#!/usr/bin/env node
/**
 * Post-deploy verification.
 *
 * Required on every push (manual or auto) to overassessed-production.
 *
 * Usage:
 *   node scripts/verify-deploy.js [expected_commit_sha]
 *
 * If expected_commit_sha is omitted, falls back to `git rev-parse HEAD`.
 *
 * Exit codes:
 *   0 = deploy verified live with expected commit + functional endpoints OK
 *   1 = wrong commit live (Render hasn't rolled or wrong repo deployed)
 *   2 = /api/version unreachable
 *   3 = functional probe failed
 *   4 = deploy timeout (waited > 8 min for new build)
 */
const https = require('https');
const { execSync } = require('child_process');

const BASE = process.env.VERIFY_BASE || 'https://overassessed.ai';
const EXPECTED_REPO = 'Aquabot1000-lab/oa-render-staging';
const TIMEOUT_MS = 8 * 60 * 1000; // 8 min
const POLL_INTERVAL_MS = 15 * 1000; // 15 s

function expectedCommit() {
    if (process.argv[2]) return process.argv[2].toLowerCase();
    try {
        return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
            .toString().trim().toLowerCase();
    } catch (_) {
        return null;
    }
}

function get(path) {
    return new Promise((resolve, reject) => {
        const req = https.get(BASE + path, { timeout: 10000 }, (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(new Error('timeout')); });
    });
}

function post(path, payload) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);
        const url = new URL(BASE + path);
        const req = https.request({
            hostname: url.hostname,
            path: url.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
            timeout: 10000,
        }, (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(new Error('timeout')); });
        req.write(data);
        req.end();
    });
}

async function main() {
    const expected = expectedCommit();
    if (!expected) {
        console.error('FAIL: could not determine expected commit (pass as argv[2] or run inside git repo)');
        process.exit(1);
    }
    console.log(`Verifying ${BASE}`);
    console.log(`Expected commit: ${expected.slice(0, 7)}`);
    console.log(`Expected repo:   ${EXPECTED_REPO}`);
    console.log(`Timeout:         ${TIMEOUT_MS / 60000} min`);
    console.log('');

    const deadline = Date.now() + TIMEOUT_MS;
    let liveCommit = null, liveRepo = null;

    while (Date.now() < deadline) {
        let v;
        try {
            v = await get('/api/version');
        } catch (e) {
            console.log(`  /api/version unreachable: ${e.message}`);
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
            continue;
        }
        if (v.status !== 200) {
            console.log(`  /api/version HTTP ${v.status}`);
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
            continue;
        }

        let parsed;
        try { parsed = JSON.parse(v.body); }
        catch (_) { console.log(`  /api/version returned non-JSON`); process.exit(2); }

        liveCommit = (parsed.commit || '').toLowerCase();
        liveRepo = parsed.repo || '';
        const liveShort = (parsed.commit_short || liveCommit.slice(0, 7));

        console.log(`  live: commit=${liveShort} repo=${liveRepo} version=${parsed.version}`);

        if (liveCommit === expected) {
            console.log(`  ✅ commit matches expected ${expected.slice(0, 7)}`);
            if (liveRepo && liveRepo !== EXPECTED_REPO) {
                console.error(`FAIL: live repo "${liveRepo}" ≠ expected "${EXPECTED_REPO}"`);
                process.exit(1);
            }
            break;
        }
        if (liveCommit === 'unknown') {
            // Render env vars not set yet — fail loud
            console.error('FAIL: live /api/version returned commit="unknown".');
            console.error('Render env vars (RENDER_GIT_COMMIT etc.) are not exposed.');
            console.error('Enable them in the Render service Settings → Environment.');
            process.exit(1);
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }

    if (liveCommit !== expected) {
        console.error(`FAIL: deploy did not roll within ${TIMEOUT_MS / 60000} min.`);
        console.error(`Wanted ${expected.slice(0, 7)}, last seen ${(liveCommit || 'none').slice(0, 7)}`);
        process.exit(4);
    }

    // ---------- Functional probe ----------
    console.log('');
    console.log('Functional probe: POST /api/esign/send with non-existent case_id');
    let r;
    try {
        r = await post('/api/esign/send', {
            case_id: `OA-DEPLOY-VERIFY-${Date.now()}`,
            email: 'deploy-verify@overassessed.invalid',
        });
    } catch (e) {
        console.error(`FAIL: functional probe error: ${e.message}`);
        process.exit(3);
    }
    if (r.status !== 404) {
        console.error(`FAIL: functional probe returned HTTP ${r.status}, expected 404`);
        console.error(`body: ${r.body.slice(0, 200)}`);
        process.exit(3);
    }
    console.log(`  ✅ HTTP 404 (invalid-case guard alive)`);

    console.log('');
    console.log(`✅ DEPLOY VERIFIED — commit ${expected.slice(0, 7)} live on ${BASE}`);
    process.exit(0);
}

main().catch((e) => {
    console.error('FAIL:', e.message);
    process.exit(2);
});
