-- Add fee agreement columns to submissions table
-- Run this against Supabase

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS fee_agreement_signature jsonb;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS fee_agreement_signed boolean DEFAULT false;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS fee_agreement_signed_at timestamptz;
