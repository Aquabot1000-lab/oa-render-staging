-- OverAssessed Database Schema
-- Run this in Supabase SQL Editor after project creation

-- Enable UUID extension (usually already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- CLIENTS
-- ============================================
CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    county TEXT,
    notification_pref TEXT DEFAULT 'both' CHECK (notification_pref IN ('email', 'sms', 'both', 'none')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_clients_email ON clients(lower(email));

-- ============================================
-- PROPERTIES
-- ============================================
CREATE TABLE properties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    city TEXT,
    state TEXT,
    zip TEXT,
    county TEXT,
    property_type TEXT,
    current_assessed_value NUMERIC(12,2),
    proposed_value NUMERIC(12,2),
    year INTEGER DEFAULT EXTRACT(YEAR FROM now()),
    property_data JSONB DEFAULT '{}',
    comp_results JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_properties_client ON properties(client_id);

-- ============================================
-- APPEALS
-- ============================================
CREATE TYPE appeal_status AS ENUM (
    'intake',
    'analysis',
    'analysis_complete',
    'form_signed',
    'filed',
    'hearing_scheduled',
    'hearing_complete',
    'resolved'
);

CREATE TABLE appeals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id TEXT NOT NULL UNIQUE,
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    state TEXT NOT NULL DEFAULT 'TX',
    county TEXT,
    status appeal_status NOT NULL DEFAULT 'intake',
    filing_date DATE,
    hearing_date DATE,
    outcome TEXT,
    estimated_savings NUMERIC(10,2),
    savings_amount NUMERIC(10,2),
    our_fee_percent NUMERIC(5,2) DEFAULT 20.00,
    our_fee_amount NUMERIC(10,2),
    notes JSONB DEFAULT '[]',
    signature JSONB,
    drip_state JSONB DEFAULT '{}',
    analysis_report JSONB,
    analysis_status TEXT DEFAULT 'not_started',
    evidence_packet_path TEXT,
    filing_data JSONB,
    pin TEXT,
    source TEXT DEFAULT 'website',
    utm_data JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_appeals_client ON appeals(client_id);
CREATE INDEX idx_appeals_property ON appeals(property_id);
CREATE INDEX idx_appeals_status ON appeals(status);
CREATE INDEX idx_appeals_case_id ON appeals(case_id);

-- ============================================
-- DOCUMENTS
-- ============================================
CREATE TYPE document_type AS ENUM (
    'notice',
    'form_50_162',
    'loa',
    'evidence',
    'filing_package',
    'other'
);

CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    appeal_id UUID REFERENCES appeals(id) ON DELETE CASCADE,
    type document_type NOT NULL DEFAULT 'other',
    file_path TEXT NOT NULL,
    file_name TEXT,
    storage_bucket TEXT DEFAULT 'documents',
    uploaded_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_documents_client ON documents(client_id);
CREATE INDEX idx_documents_appeal ON documents(appeal_id);

-- ============================================
-- PAYMENTS
-- ============================================
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    appeal_id UUID REFERENCES appeals(id) ON DELETE CASCADE,
    stripe_payment_id TEXT,
    amount NUMERIC(10,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'refunded')),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_payments_client ON payments(client_id);
CREATE INDEX idx_payments_appeal ON payments(appeal_id);

-- ============================================
-- CASE ID COUNTER (for OA-XXXX generation)
-- ============================================
CREATE TABLE case_counter (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    last_case_number INTEGER NOT NULL DEFAULT 0
);

INSERT INTO case_counter (id, last_case_number) VALUES (1, 0);

-- Function to get next case ID atomically
CREATE OR REPLACE FUNCTION next_case_id()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    next_num INTEGER;
BEGIN
    UPDATE case_counter SET last_case_number = last_case_number + 1 WHERE id = 1
    RETURNING last_case_number INTO next_num;
    RETURN 'OA-' || LPAD(next_num::TEXT, 4, '0');
END;
$$;

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER clients_updated_at
    BEFORE UPDATE ON clients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER appeals_updated_at
    BEFORE UPDATE ON appeals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
