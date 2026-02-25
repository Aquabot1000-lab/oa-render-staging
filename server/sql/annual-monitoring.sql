-- Annual monitoring columns on clients table
ALTER TABLE clients ADD COLUMN IF NOT EXISTS annual_monitoring BOOLEAN DEFAULT false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS monitoring_years JSONB DEFAULT '{}';
