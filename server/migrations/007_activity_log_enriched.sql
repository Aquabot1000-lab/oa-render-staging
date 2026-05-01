-- 007_activity_log_enriched.sql
-- Authorized: Tyler Worthey msg 28313 (2026-05-01 17:54 CDT) — CRM Operator Mode Phase 0.5
--
-- Adds canonical event/before/after triplet to activity_log for every controller mutation.
-- Backward compatible: action/details columns retained.

ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS event  TEXT;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS before JSONB;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS after  JSONB;

-- Index for filtering by event type
CREATE INDEX IF NOT EXISTS activity_log_event_idx        ON activity_log (event);
CREATE INDEX IF NOT EXISTS activity_log_case_id_event_idx ON activity_log (case_id, event, created_at DESC);
