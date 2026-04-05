-- County Data Warehouse Table
-- Stores property records from all counties we operate in
-- Used for: address verification, comp selection, value history

CREATE TABLE IF NOT EXISTS county_properties (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    state text NOT NULL,
    county text NOT NULL,
    parcel_id text,
    owner_name text,
    property_address text NOT NULL,
    property_type text,
    beds int,
    baths numeric,
    sqft int,
    lot_size numeric,
    year_built int,
    assessed_value_current numeric,
    assessed_value_prior numeric,
    sale_price_last numeric,
    sale_date_last date,
    source text NOT NULL,
    source_record_id text,
    imported_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_cp_state_county ON county_properties(state, county);
CREATE INDEX IF NOT EXISTS idx_cp_address ON county_properties USING gin(to_tsvector('english', property_address));
CREATE INDEX IF NOT EXISTS idx_cp_parcel ON county_properties(parcel_id) WHERE parcel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cp_county_sqft ON county_properties(county, sqft) WHERE sqft IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cp_sale_date ON county_properties(sale_date_last) WHERE sale_date_last IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cp_sale_price ON county_properties(sale_price_last) WHERE sale_price_last IS NOT NULL;

-- RLS policy: allow authenticated users to read
ALTER TABLE county_properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow authenticated read" ON county_properties FOR SELECT TO authenticated USING (true);
CREATE POLICY IF NOT EXISTS "Allow service write" ON county_properties FOR ALL TO service_role USING (true);
