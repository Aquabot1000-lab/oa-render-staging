# Deploy Pipeline — OverAssessed Production

**Single source of truth.** Read this before pushing.

## The One Rule

**Production deploys ONLY from `Aquabot1000-lab/oa-render-staging` (branch `main`).**

The `overassessed-ai` repo is a working/scratch repo. Pushes there do **not** reach production. Render has no webhook on it.

## Service identity

| | |
|---|---|
| Render service | `overassessed-production` |
| Render service id | `srv-d7a4ar2a214c73bhu6lg` |
| Production repo | `https://github.com/Aquabot1000-lab/oa-render-staging` |
| Production branch | `main` |
| Auto-deploy | enabled, trigger = commit |
| Public URL | https://overassessed.ai |

## Standard push flow

```bash
# From your working clone:
git push render-prod main          # NOT 'origin'
node scripts/verify-deploy.js      # blocks until live & functional, exit 0 = OK
```

If `render-prod` remote is missing:

```bash
git remote add render-prod https://github.com/Aquabot1000-lab/oa-render-staging.git
```

## Force a manual deploy (when auto-deploy is delayed)

```bash
render deploys create srv-d7a4ar2a214c73bhu6lg --confirm
```

## Verifying a deploy

`/api/version` is the canonical truth:

```bash
curl -s https://overassessed.ai/api/version
# {
#   "version": "...",            ← BUILD_VERSION (ms epoch base36, changes every restart)
#   "deployed": "...",           ← timestamp of THIS request
#   "started_at": "...",         ← ISO time the running process booted
#   "commit": "<full sha>",      ← from RENDER_GIT_COMMIT
#   "commit_short": "...",       ← first 7 chars
#   "repo": "Aquabot1000-lab/oa-render-staging",
#   "branch": "main"
# }
```

If `commit === "unknown"`, Render's git env vars are not exposed to the service.
Fix: Render dashboard → service → Environment → ensure `RENDER_GIT_COMMIT`, `RENDER_GIT_REPO_SLUG`, `RENDER_GIT_BRANCH` are available (these are auto-set by Render when "Expose git context" is enabled).

`scripts/verify-deploy.js` is the single canonical post-deploy verifier:

- Polls `/api/version` until `commit === <expected>` (or 8-min timeout).
- Confirms `repo === Aquabot1000-lab/oa-render-staging`.
- Hits `POST /api/esign/send` with a synthetic non-existent case_id and asserts HTTP 404 (proves the invalid-case guard from commit `8808c5c`+ is live).

Exit codes:

| code | meaning |
|---|---|
| 0 | verified |
| 1 | wrong commit / wrong repo |
| 2 | endpoint unreachable |
| 3 | functional probe failed |
| 4 | timed out waiting for new build |

## Why misrouting happened (postmortem 2026-05-02)

- The local working clone was originally cloned from `overassessed-ai` (the older repo, predates the staging→prod migration on 2026-04-06).
- After the migration, `overassessed-ai` was kept around but Render was reconfigured to pull from `oa-render-staging`.
- `origin` was never re-pointed. Pushes to `origin main` looked successful, but Render had no webhook on that repo, so production silently kept running whatever was last on `oa-render-staging/main`.
- BUILD_VERSION (epoch-based) appeared to "change after my push" only by coincidence — it changes on every Render restart, regardless of the commit deployed.
- This is now caught by `/api/version` exposing `commit` + `repo`, and by `scripts/verify-deploy.js` failing loudly if either drifts.

## What MUST NOT happen again

- ❌ Pushing to `origin` (= `overassessed-ai`) and assuming production updated.
- ❌ Trusting BUILD_VERSION timestamp alone as proof of deploy.
- ❌ Skipping `verify-deploy.js` after a push.

## Archival note for `overassessed-ai`

That repo is **non-production**. Mark it explicitly: rename or archive on GitHub (`gh repo archive Aquabot1000-lab/overassessed-ai`) once any unmerged work is forwarded to `oa-render-staging`. Until archived, treat it as scratch only.
