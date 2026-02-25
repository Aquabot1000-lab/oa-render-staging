-- Filings table for the filing queue & automation system
CREATE TABLE IF NOT EXISTS filings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
    appeal_id UUID REFERENCES appeals(id) ON DELETE CASCADE,
    county TEXT,
    state TEXT DEFAULT 'TX',
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'form_generated', 'form_signed', 'filed', 'hearing_scheduled', 'hearing_complete', 'settled', 'closed')),
    portal_url TEXT,
    portal_pin TEXT,
    portal_account_id TEXT,
    form_50_162_signed BOOLEAN DEFAULT false,
    form_50_162_url TEXT,
    evidence_packet_url TEXT,
    filing_date TIMESTAMPTZ,
    filing_confirmation TEXT,
    hearing_date TIMESTAMPTZ,
    hearing_type TEXT CHECK (hearing_type IS NULL OR hearing_type IN ('informal', 'arb', 'boe', 'written')),
    hearing_format TEXT CHECK (hearing_format IS NULL OR hearing_format IN ('phone', 'video', 'in_person', 'written')),
    settlement_offer NUMERIC,
    settlement_accepted BOOLEAN,
    final_value NUMERIC,
    original_value NUMERIC,
    savings NUMERIC,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_filings_client ON filings(client_id);
CREATE INDEX IF NOT EXISTS idx_filings_property ON filings(property_id);
CREATE INDEX IF NOT EXISTS idx_filings_appeal ON filings(appeal_id);
CREATE INDEX IF NOT EXISTS idx_filings_status ON filings(status);
CREATE INDEX IF NOT EXISTS idx_filings_county ON filings(county);

-- Auto-update updated_at
CREATE TRIGGER filings_updated_at
    BEFORE UPDATE ON filings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
