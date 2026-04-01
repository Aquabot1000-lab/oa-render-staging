-- 002_lead_pipeline.sql
-- OA Lead → Close Pipeline Schema
-- Run with: psql connection string < 002_lead_pipeline.sql

-- 1. Add pipeline columns to clients table
ALTER TABLE clients 
  ADD COLUMN IF NOT EXISTS lead_stage TEXT DEFAULT 'new_lead'
    CHECK (lead_stage IN ('new_lead', 'analyzed', 'contacted', 'engaged', 'signed', 'filed', 'closed')),
  ADD COLUMN IF NOT EXISTS lead_source TEXT,  -- 'google_ads', 'meta_ads', 'organic', 'referral', 'direct'
  ADD COLUMN IF NOT EXISTS lead_score INTEGER DEFAULT 0,  -- 0-100
  ADD COLUMN IF NOT EXISTS stage_updated_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS first_contacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS filed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS estimated_savings NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS actual_savings NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS assigned_to TEXT DEFAULT 'aquabot',  -- 'aquabot', 'tyler', 'uri'
  ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- 2. Lead activity log (tracks every touchpoint)
CREATE TABLE IF NOT EXISTS lead_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL 
    CHECK (activity_type IN (
      'stage_change', 'email_sent', 'email_opened', 'email_replied',
      'sms_sent', 'sms_replied', 'phone_call', 'form_submitted',
      'document_uploaded', 'note_added', 'escalation', 'auto_followup'
    )),
  from_stage TEXT,
  to_stage TEXT,
  details JSONB DEFAULT '{}',
  created_by TEXT DEFAULT 'system',  -- 'system', 'aquabot', 'tyler'
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Follow-up schedule table
CREATE TABLE IF NOT EXISTS follow_up_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL,
  follow_up_type TEXT NOT NULL 
    CHECK (follow_up_type IN ('email', 'sms', 'phone', 'escalation')),
  template_key TEXT,  -- references email template
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  attempt_count INTEGER DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Pipeline metrics view
CREATE OR REPLACE VIEW pipeline_metrics AS
SELECT 
  lead_stage,
  COUNT(*) as count,
  ROUND(COUNT(*)::NUMERIC / NULLIF((SELECT COUNT(*) FROM clients WHERE lead_stage != 'closed'), 0) * 100, 1) as pct,
  AVG(estimated_savings) as avg_estimated_savings,
  AVG(EXTRACT(EPOCH FROM (stage_updated_at - created_at)) / 86400)::INTEGER as avg_days_in_pipeline
FROM clients
GROUP BY lead_stage
ORDER BY 
  CASE lead_stage 
    WHEN 'new_lead' THEN 1
    WHEN 'analyzed' THEN 2
    WHEN 'contacted' THEN 3
    WHEN 'engaged' THEN 4
    WHEN 'signed' THEN 5
    WHEN 'filed' THEN 6
    WHEN 'closed' THEN 7
  END;

-- 5. Conversion funnel view
CREATE OR REPLACE VIEW conversion_funnel AS
WITH stage_counts AS (
  SELECT
    COUNT(*) FILTER (WHERE lead_stage IN ('new_lead','analyzed','contacted','engaged','signed','filed','closed')) as total_leads,
    COUNT(*) FILTER (WHERE lead_stage IN ('contacted','engaged','signed','filed','closed')) as contacted,
    COUNT(*) FILTER (WHERE lead_stage IN ('engaged','signed','filed','closed')) as engaged,
    COUNT(*) FILTER (WHERE lead_stage IN ('signed','filed','closed')) as signed,
    COUNT(*) FILTER (WHERE lead_stage IN ('filed','closed')) as filed,
    COUNT(*) FILTER (WHERE lead_stage = 'closed') as closed
  FROM clients
)
SELECT 
  total_leads,
  contacted,
  CASE WHEN total_leads > 0 THEN ROUND(contacted::NUMERIC / total_leads * 100, 1) END as contact_rate,
  engaged,
  CASE WHEN contacted > 0 THEN ROUND(engaged::NUMERIC / contacted * 100, 1) END as engage_rate,
  signed,
  CASE WHEN engaged > 0 THEN ROUND(signed::NUMERIC / engaged * 100, 1) END as sign_rate,
  filed,
  closed,
  CASE WHEN total_leads > 0 THEN ROUND(signed::NUMERIC / total_leads * 100, 1) END as overall_close_rate
FROM stage_counts;

-- 6. Index for performance
CREATE INDEX IF NOT EXISTS idx_clients_lead_stage ON clients(lead_stage);
CREATE INDEX IF NOT EXISTS idx_clients_priority ON clients(priority);
CREATE INDEX IF NOT EXISTS idx_lead_activity_client ON lead_activity(client_id);
CREATE INDEX IF NOT EXISTS idx_lead_activity_created ON lead_activity(created_at);
CREATE INDEX IF NOT EXISTS idx_follow_up_schedule_pending ON follow_up_schedule(scheduled_at) WHERE status = 'pending';
