-- Uri License Commission Tracker
-- Tyler owes Uri 10% of ALL billing to Texas customers for use of Uri's TX real estate license

CREATE TABLE IF NOT EXISTS uri_commissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
    case_number TEXT,
    client_name TEXT NOT NULL,
    property_address TEXT,
    state TEXT DEFAULT 'TX',
    billing_amount NUMERIC(10,2) NOT NULL,
    commission_rate NUMERIC(4,3) DEFAULT 0.10,
    commission_amount NUMERIC(10,2) GENERATED ALWAYS AS (billing_amount * commission_rate) STORED,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accrued', 'paid', 'waived')),
    billing_date DATE,
    paid_date DATE,
    payment_method TEXT,
    payment_reference TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_uri_commissions_client ON uri_commissions(client_id);
CREATE INDEX IF NOT EXISTS idx_uri_commissions_status ON uri_commissions(status);
CREATE INDEX IF NOT EXISTS idx_uri_commissions_state ON uri_commissions(state);
CREATE INDEX IF NOT EXISTS idx_uri_commissions_billing_date ON uri_commissions(billing_date);

-- RLS: Admin only
ALTER TABLE uri_commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can manage uri_commissions" ON uri_commissions
    FOR ALL USING (is_admin());

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_uri_commissions_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER uri_commissions_updated_at
    BEFORE UPDATE ON uri_commissions
    FOR EACH ROW
    EXECUTE FUNCTION update_uri_commissions_timestamp();

-- Note: Run this SQL in your Supabase SQL Editor
-- Then verify with: SELECT * FROM uri_commissions LIMIT 1;
