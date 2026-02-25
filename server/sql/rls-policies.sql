-- OverAssessed.ai Row Level Security Policies
-- Run AFTER schema.sql in Supabase SQL Editor

-- ============================================
-- HELPER: Check if user is admin/agent
-- ============================================
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM auth.users
        WHERE id = auth.uid()
        AND (
            raw_user_meta_data->>'role' = 'admin'
            OR raw_user_meta_data->>'role' = 'agent'
        )
    );
END;
$$;

-- ============================================
-- CLIENTS
-- ============================================
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Clients see only their own record
CREATE POLICY "clients_select_own" ON clients
    FOR SELECT USING (auth_user_id = auth.uid() OR is_admin());

-- Only admins/service role can insert
CREATE POLICY "clients_insert_admin" ON clients
    FOR INSERT WITH CHECK (is_admin() OR auth.uid() IS NULL);

-- Admins can update any; clients can update own
CREATE POLICY "clients_update" ON clients
    FOR UPDATE USING (auth_user_id = auth.uid() OR is_admin());

-- Only admins can delete
CREATE POLICY "clients_delete_admin" ON clients
    FOR DELETE USING (is_admin());

-- ============================================
-- PROPERTIES
-- ============================================
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "properties_select" ON properties
    FOR SELECT USING (
        client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
        OR is_admin()
    );

CREATE POLICY "properties_insert" ON properties
    FOR INSERT WITH CHECK (is_admin() OR auth.uid() IS NULL);

CREATE POLICY "properties_update" ON properties
    FOR UPDATE USING (is_admin());

CREATE POLICY "properties_delete" ON properties
    FOR DELETE USING (is_admin());

-- ============================================
-- APPEALS
-- ============================================
ALTER TABLE appeals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "appeals_select" ON appeals
    FOR SELECT USING (
        client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
        OR is_admin()
    );

CREATE POLICY "appeals_insert" ON appeals
    FOR INSERT WITH CHECK (is_admin() OR auth.uid() IS NULL);

CREATE POLICY "appeals_update" ON appeals
    FOR UPDATE USING (is_admin());

CREATE POLICY "appeals_delete" ON appeals
    FOR DELETE USING (is_admin());

-- ============================================
-- DOCUMENTS
-- ============================================
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "documents_select" ON documents
    FOR SELECT USING (
        client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
        OR is_admin()
    );

-- Clients can upload their own docs
CREATE POLICY "documents_insert" ON documents
    FOR INSERT WITH CHECK (
        client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
        OR is_admin()
        OR auth.uid() IS NULL
    );

CREATE POLICY "documents_delete" ON documents
    FOR DELETE USING (is_admin());

-- ============================================
-- PAYMENTS
-- ============================================
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payments_select" ON payments
    FOR SELECT USING (
        client_id IN (SELECT id FROM clients WHERE auth_user_id = auth.uid())
        OR is_admin()
    );

CREATE POLICY "payments_insert" ON payments
    FOR INSERT WITH CHECK (is_admin() OR auth.uid() IS NULL);

CREATE POLICY "payments_update" ON payments
    FOR UPDATE USING (is_admin());

-- ============================================
-- CASE COUNTER (admin only)
-- ============================================
ALTER TABLE case_counter ENABLE ROW LEVEL SECURITY;

CREATE POLICY "case_counter_admin" ON case_counter
    FOR ALL USING (is_admin() OR auth.uid() IS NULL);

-- ============================================
-- STORAGE BUCKET for documents
-- ============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: clients can upload to their folder, admins see all
CREATE POLICY "documents_storage_select" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'documents'
        AND (
            is_admin()
            OR (storage.foldername(name))[1] IN (
                SELECT id::text FROM clients WHERE auth_user_id = auth.uid()
            )
        )
    );

CREATE POLICY "documents_storage_insert" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'documents'
        AND (
            is_admin()
            OR auth.uid() IS NULL
            OR (storage.foldername(name))[1] IN (
                SELECT id::text FROM clients WHERE auth_user_id = auth.uid()
            )
        )
    );

CREATE POLICY "documents_storage_delete" ON storage.objects
    FOR DELETE USING (
        bucket_id = 'documents' AND is_admin()
    );
