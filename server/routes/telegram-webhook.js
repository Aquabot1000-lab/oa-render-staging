/**
 * routes/telegram-webhook.js
 *
 * Telegram bot webhook handler — team commands (Uri + Tyler).
 *
 * History: server.js:438 has been requiring this module since commit 6c02856
 * (2026-05-01 14:06 CDT) but the file was never committed to git, causing
 * three consecutive deploys to crash with `Cannot find module './routes/telegram-webhook'`.
 * This stub restores deploy and returns 200 OK on Telegram POSTs so the bot does
 * not retry-storm the endpoint while real command handling is built out.
 *
 * Mounted at: /webhooks/telegram
 *
 * What it does today:
 *   - POST /             → 200 ok (acknowledges Telegram updates, no-op processing)
 *   - GET  /             → 200 ok (health probe)
 *   - GET  /health       → 200 ok
 *
 * What it intentionally does NOT do (until the team-commands feature is designed):
 *   - parse Telegram update payloads
 *   - dispatch /commands
 *   - respond via Telegram bot API
 *
 * If you want full command handling, replace the body of the POST handler with
 * the dispatcher of your choice (e.g. delegate to services/team-commands.js).
 */

'use strict';

const express = require('express');
const router = express.Router();

// Health probes
router.get('/', (_req, res) => res.json({ status: 'ok', service: 'telegram-webhook', ready: true }));
router.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Telegram webhook receiver. Telegram requires a fast 200 — anything else
// triggers retries. Log the update id for traceability and acknowledge.
router.post('/', express.json({ limit: '256kb' }), (req, res) => {
  try {
    const u = req.body || {};
    const updateId = u.update_id || null;
    const fromId = u.message?.from?.id || u.callback_query?.from?.id || null;
    const text = (u.message?.text || u.callback_query?.data || '').slice(0, 200);
    if (updateId) {
      console.log(`[telegram-webhook] update_id=${updateId} from=${fromId} text=${JSON.stringify(text)}`);
    }
    // No-op: future team-command dispatching plugs in here.
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[telegram-webhook] error:', e.message);
    // Still 200 so Telegram does not hammer-retry on bot-side bugs.
    res.status(200).json({ ok: true, note: 'error swallowed' });
  }
});

module.exports = router;
