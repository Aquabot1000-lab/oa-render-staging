-- ═══════════════════════════════════════════════════════════════════════════
-- 009_pipeline_board_indexes.sql  (Phase 5 — 2026-05-02, Tyler msg 28585)
-- ───────────────────────────────────────────────────────────────────────────
-- Pipeline Board (/api/pipeline-board) needs to bucket up to a few hundred
-- active cases by flag combinations and sort by estimated_revenue DESC.
-- Each request hits ~6-8 boolean flag fields, plus a sort.
--
-- Performance plan:
--   - Partial indexes on the hot flag combinations (small + selective)
--   - Compound index on (estimated_revenue DESC, last_activity_at DESC) for sort
--   - Filtered idx for FILED / lock columns
--
-- All indexes are CREATE INDEX IF NOT EXISTS so the migration is idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- Sort key for board cards (revenue first, then recency for ties)
CREATE INDEX IF NOT EXISTS idx_submissions_board_sort
    ON submissions (estimated_revenue DESC NULLS LAST, last_activity_at DESC NULLS LAST)
    WHERE deleted_at IS NULL;

-- Hot flag fields (board column predicates)
CREATE INDEX IF NOT EXISTS idx_submissions_aoa_signed
    ON submissions (aoa_signed)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_submissions_notice_received
    ON submissions (notice_received)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_submissions_filing_ready
    ON submissions (filing_ready)
    WHERE deleted_at IS NULL AND filing_ready = true;

CREATE INDEX IF NOT EXISTS idx_submissions_filing_status
    ON submissions (filing_status)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_submissions_manual_status_lock
    ON submissions (manual_status_lock)
    WHERE deleted_at IS NULL AND manual_status_lock = true;

CREATE INDEX IF NOT EXISTS idx_submissions_status
    ON submissions (status)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_submissions_last_outreach_at
    ON submissions (last_outreach_at)
    WHERE deleted_at IS NULL;

-- Activity-recency for tie-breakers / recent-only views
CREATE INDEX IF NOT EXISTS idx_submissions_last_activity_at
    ON submissions (last_activity_at DESC)
    WHERE deleted_at IS NULL;
