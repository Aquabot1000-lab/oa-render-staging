-- Migration 011: outcome tracking + revenue attribution
-- Phase 10 — Close Tracking + Revenue Attribution (Tyler msg 28887)
-- DO NOT run this migration directly — Tyler applies manually in Supabase Dashboard.
--
-- Additive only. No breaking changes to existing flows.
-- Existing code reads/writes `outcome` (text) and `outcome_status` is the new
-- canonical close-state field; both can coexist during rollout.

-- ── columns ────────────────────────────────────────────────────────────────

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS outcome_status     text,        -- 'won' | 'lost' | 'no_change' | 'withdrawn'
  ADD COLUMN IF NOT EXISTS outcome_date       timestamptz,
  ADD COLUMN IF NOT EXISTS final_value        numeric,     -- post-protest assessed value
  ADD COLUMN IF NOT EXISTS original_value     numeric,     -- assessed value at time of close (snapshot)
  ADD COLUMN IF NOT EXISTS tax_savings        numeric,     -- (original - final) * effective_tax_rate
  ADD COLUMN IF NOT EXISTS revenue_collected  numeric,     -- our fee on tax_savings (typically 25%)
  ADD COLUMN IF NOT EXISTS closed_at          timestamptz, -- when removed from active pipeline
  ADD COLUMN IF NOT EXISTS closed_by          text;        -- actor that closed (e.g. 'tyler')

-- ── value constraint: outcome_status must be one of the four allowed values when set
ALTER TABLE submissions
  DROP CONSTRAINT IF EXISTS submissions_outcome_status_chk;

ALTER TABLE submissions
  ADD CONSTRAINT submissions_outcome_status_chk
  CHECK (
    outcome_status IS NULL
    OR outcome_status IN ('won','lost','no_change','withdrawn')
  );

-- ── indexes for /api/outcomes/summary aggregation ─────────────────────────

CREATE INDEX IF NOT EXISTS idx_submissions_outcome_status
  ON submissions (outcome_status)
  WHERE outcome_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_submissions_outcome_date
  ON submissions (outcome_date DESC)
  WHERE outcome_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_submissions_closed_at
  ON submissions (closed_at DESC)
  WHERE closed_at IS NOT NULL;

-- ── comment trail (for future readers) ────────────────────────────────────

COMMENT ON COLUMN submissions.outcome_status   IS 'Phase 10: terminal outcome — won|lost|no_change|withdrawn';
COMMENT ON COLUMN submissions.outcome_date     IS 'Phase 10: when the protest outcome was recorded';
COMMENT ON COLUMN submissions.final_value      IS 'Phase 10: assessed value AFTER protest (or settlement)';
COMMENT ON COLUMN submissions.original_value   IS 'Phase 10: assessed value at moment of close (snapshot for audit)';
COMMENT ON COLUMN submissions.tax_savings      IS 'Phase 10: (original_value - final_value) * effective_tax_rate';
COMMENT ON COLUMN submissions.revenue_collected IS 'Phase 10: OverAssessed fee earned (typically 25% of tax_savings)';
COMMENT ON COLUMN submissions.closed_at        IS 'Phase 10: timestamp when case was removed from active pipeline';
COMMENT ON COLUMN submissions.closed_by        IS 'Phase 10: actor that closed the case (audit trail)';
