# Database Migration: Initiation Fee Tracking

## Overview
Add columns to the `submissions` table to track the $79 initiation fee payment status.

## SQL Migration

Run this SQL in Supabase SQL Editor:

```sql
-- Add initiation fee tracking columns to submissions table
ALTER TABLE submissions
ADD COLUMN IF NOT EXISTS initiation_paid BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS initiation_payment_id TEXT,
ADD COLUMN IF NOT EXISTS initiation_paid_at TIMESTAMPTZ;

-- Add comment to explain the columns
COMMENT ON COLUMN submissions.initiation_paid IS 'Whether the $79 initiation fee has been paid';
COMMENT ON COLUMN submissions.initiation_payment_id IS 'Stripe payment_intent ID for the initiation fee';
COMMENT ON COLUMN submissions.initiation_paid_at IS 'Timestamp when initiation fee was paid';

-- Create index for querying unpaid initiation fees
CREATE INDEX IF NOT EXISTS idx_submissions_initiation_paid ON submissions(initiation_paid);
```

## Verification

After running the migration, verify with:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'submissions'
  AND column_name IN ('initiation_paid', 'initiation_payment_id', 'initiation_paid_at');
```

## Rollback (if needed)

```sql
-- Remove the columns if needed
ALTER TABLE submissions
DROP COLUMN IF EXISTS initiation_paid,
DROP COLUMN IF EXISTS initiation_payment_id,
DROP COLUMN IF EXISTS initiation_paid_at;

DROP INDEX IF EXISTS idx_submissions_initiation_paid;
```

## Notes

- The `initiation_paid` column defaults to `FALSE` for all existing submissions
- Existing submissions created before this migration will show as unpaid
- The $79 initiation fee is credited toward the final contingency fee upon successful appeal
- Payment is processed via Stripe Checkout and tracked via webhook (`checkout.session.completed` event)
