-- Exemptions table
CREATE TABLE IF NOT EXISTS exemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    exemption_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    filing_date DATE,
    outcome TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exemptions_client ON exemptions(client_id);
CREATE INDEX IF NOT EXISTS idx_exemptions_status ON exemptions(status);
