-- Migration 011: inbound reply tracking + sentiment + global safety rule fields
-- Priority fix (Tyler msg 30413, 2026-05-06) — inbound SMS pipeline repair
-- DO NOT run this migration directly — Tyler applies manually in Supabase Dashboard.

-- submissions: reply tracking
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS replied boolean NOT NULL DEFAULT false;

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS last_customer_reply_at timestamptz;

-- sentiment_flag: hostile | frustrated | neutral | positive | opt_out | ooc (out-of-country)
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS sentiment_flag text;

-- inbound_reply_paused: global safety rule — true = do not push until Tyler reviews
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS inbound_reply_paused boolean NOT NULL DEFAULT false;

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS inbound_reply_paused_reason text;

-- communications: per-message sentiment + review flag
ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS sentiment text;

ALTER TABLE communications
  ADD COLUMN IF NOT EXISTS review_required boolean NOT NULL DEFAULT false;

-- Index for quick filtering of paused/replied cases
CREATE INDEX IF NOT EXISTS idx_submissions_replied
  ON submissions (replied) WHERE replied = true;

CREATE INDEX IF NOT EXISTS idx_submissions_inbound_reply_paused
  ON submissions (inbound_reply_paused) WHERE inbound_reply_paused = true;

-- Comments for future reference
COMMENT ON COLUMN submissions.replied IS 'True once any inbound SMS/email reply received from customer';
COMMENT ON COLUMN submissions.last_customer_reply_at IS 'Timestamp of most recent inbound reply from customer';
COMMENT ON COLUMN submissions.sentiment_flag IS 'Sentiment classification: hostile|frustrated|neutral|positive|opt_out|ooc';
COMMENT ON COLUMN submissions.inbound_reply_paused IS 'Global safety rule: block automated outreach until Tyler reviews inbound reply';
COMMENT ON COLUMN submissions.inbound_reply_paused_reason IS 'Why outreach was paused on reply (auto-set by inbound handler)';
COMMENT ON COLUMN communications.sentiment IS 'Per-message sentiment: hostile|frustrated|neutral|positive|opt_out';
COMMENT ON COLUMN communications.review_required IS 'True if this message needs Tyler review before next outbound push';
