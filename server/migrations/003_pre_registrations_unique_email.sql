-- Migration: unique constraint on pre_registrations(email)
-- Prevents duplicate sign-ups from the same email address.
-- Applied: 2026-04-19

-- First remove any remaining duplicates, keeping the most recent per email
DELETE FROM pre_registrations
WHERE id NOT IN (
  SELECT DISTINCT ON (lower(email)) id
  FROM pre_registrations
  ORDER BY lower(email), created_at DESC
);

-- Add unique index (case-insensitive) on email
CREATE UNIQUE INDEX IF NOT EXISTS pre_registrations_email_unique
  ON pre_registrations (lower(email));
