-- Add new property detail columns to the properties table
-- Run this against Supabase if the properties table exists

ALTER TABLE properties ADD COLUMN IF NOT EXISTS bedrooms integer;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS bathrooms numeric(3,1);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS sqft integer;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS year_built integer;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS renovations text DEFAULT 'No';
ALTER TABLE properties ADD COLUMN IF NOT EXISTS renovation_desc text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS condition_issues text DEFAULT 'No';
ALTER TABLE properties ADD COLUMN IF NOT EXISTS condition_desc text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS recent_appraisal text DEFAULT 'No';
ALTER TABLE properties ADD COLUMN IF NOT EXISTS appraised_value text;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS appraisal_date date;
