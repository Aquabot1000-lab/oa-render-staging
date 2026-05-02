-- Migration 010: automation_flags column + GIN index
-- Phase 8 — Automation + Daily Command (Tyler msg 28665)
-- DO NOT run this migration directly — Tyler applies manually in Supabase Dashboard.

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS automation_flags jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_submissions_automation_flags_gin
  ON submissions USING gin (automation_flags);
