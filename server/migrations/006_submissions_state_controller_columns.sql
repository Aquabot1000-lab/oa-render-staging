-- 006_submissions_state_controller_columns.sql
-- Authorized: Tyler Worthey msg 28194 (2026-05-01 14:53 CDT)
--             Tyler Worthey msg 28217 (2026-05-01 15:02 CDT) — metric definitions
--             Tyler Worthey msg 28231 (2026-05-01 15:10 CDT) — full migration approved
--
-- Single-source-of-truth state controller columns + standardized metric fields.
-- All columns IF NOT EXISTS — safe to re-run.

-- ─── derived flag columns (controller-maintained) ───────────────────────────
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS aoa_signed       boolean DEFAULT false;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS notice_received  boolean DEFAULT false;
-- filing_ready already exists

-- ─── Tyler-spec metric columns (msg 28217) ─────────────────────────────────
-- Reduction Value = assessed - LOWEST adjusted comp value
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS estimated_reduction_value numeric(12,0);
-- Tax Savings = reduction * estimated_tax_rate (annual customer savings)
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS estimated_tax_savings     numeric(12,0);
-- Revenue = tax_savings * 0.25 (OverAssessed fee on actual savings)
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS estimated_revenue         numeric(12,0);
-- Effective property tax rate used for the calculation (county-specific)
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS estimated_tax_rate        numeric(6,4);
-- Lowest adjusted comp value (the opening anchor / aggressive ask)
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS comp_low_anchor_value     numeric(12,0);
-- Median comp value (internal reference only — settlement target)
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS settlement_estimate_value numeric(12,0);

-- ─── Backfills from current data ───────────────────────────────────────────
UPDATE submissions
   SET aoa_signed = true
 WHERE aoa_signed IS DISTINCT FROM true
   AND fee_agreement_signed = true;

UPDATE submissions
   SET notice_received = true
 WHERE notice_received IS DISTINCT FROM true
   AND (upload_status = 'verified_notice'
        OR (notice_url IS NOT NULL
            AND upload_status NOT IN ('wrong_document','invalid_notice_uploaded')));

-- NOTE: estimated_reduction_value / estimated_tax_savings / estimated_revenue /
-- comp_low_anchor_value / settlement_estimate_value get populated by
-- rebuildAllMetrics() after this migration applies — the math requires comp_results.
-- We deliberately do NOT seed them with the legacy estimated_savings column because
-- those numbers used a different (mixed) definition.

-- ─── Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS submissions_aoa_signed_idx       ON submissions (aoa_signed)       WHERE aoa_signed = true;
CREATE INDEX IF NOT EXISTS submissions_notice_received_idx  ON submissions (notice_received)  WHERE notice_received = true;
CREATE INDEX IF NOT EXISTS submissions_filing_ready_idx     ON submissions (filing_ready)     WHERE filing_ready = true;
CREATE INDEX IF NOT EXISTS submissions_est_revenue_idx      ON submissions (estimated_revenue);
CREATE INDEX IF NOT EXISTS submissions_est_tax_savings_idx  ON submissions (estimated_tax_savings);
