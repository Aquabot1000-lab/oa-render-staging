require('dotenv').config({ path: '/Users/aquabot/Documents/OverAssessed/server/.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  console.log('[migrate-auth] === Phase 1: ensure tables exist (via PostgREST + raw SQL) ===');

  // Supabase JS client doesn't run DDL directly — use the SQL HTTP endpoint via fetch
  const SQL_URL = `${process.env.SUPABASE_URL}/rest/v1/rpc/exec_sql`;
  // exec_sql may not exist. Better path: use the Supabase /database query endpoint or do DDL via REST is impossible.
  // We'll output the SQL for Tyler to run, OR check if the tables already exist.

  // Check if tables exist
  const { data: u, error: uErr } = await sb.from('auth_users').select('email').limit(1);
  const { data: t, error: tErr } = await sb.from('auth_setup_tokens').select('token').limit(1);

  console.log('  auth_users table:', uErr ? `MISSING (${uErr.code}: ${uErr.message})` : `EXISTS (${u.length} rows fetched)`);
  console.log('  auth_setup_tokens table:', tErr ? `MISSING (${tErr.code}: ${tErr.message})` : `EXISTS (${t.length} rows fetched)`);

  // Check what schema-creation surface is available
  console.log('\n[migrate-auth] === Probe for SQL DDL surface ===');

  // Try Supabase Management API — needs separate token, not service role. Skip.
  // Best alternative: Tyler runs the DDL via Supabase SQL editor. I'll generate the SQL.

  console.log('\n[migrate-auth] === DDL to run (auto-runnable if exec_sql RPC exists) ===');
  const ddl = `
-- Migration: auth tables to Supabase (2026-04-29)
CREATE TABLE IF NOT EXISTS auth_users (
  id              text PRIMARY KEY,
  email           text UNIQUE NOT NULL,
  password_hash   text NOT NULL,
  name            text,
  role            text NOT NULL DEFAULT 'admin',
  must_change_password  boolean NOT NULL DEFAULT false,
  partner_pct     numeric,
  deprecated_from text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_setup_tokens (
  token       text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  email       text NOT NULL,
  kind        text NOT NULL,             -- 'admin_issued' or 'forced_change'
  issued_by   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(lower(email));
CREATE INDEX IF NOT EXISTS idx_auth_setup_tokens_user_id ON auth_setup_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_setup_tokens_expires ON auth_setup_tokens(expires_at);
`;
  fs.writeFileSync('/tmp/migration-auth.sql', ddl);
  console.log(ddl);
  console.log('SQL written to /tmp/migration-auth.sql');

  // Try to run via PostgREST / pg endpoint  — Supabase exposes SQL execution only through:
  //   - The Studio UI
  //   - The Management API (separate access token)
  //   - A custom RPC function (if exec_sql or similar exists)
  console.log('\n[migrate-auth] === Try RPC exec via supabase-js ===');
  const { data: rpcData, error: rpcErr } = await sb.rpc('exec_sql', { sql: ddl });
  if (rpcErr) {
    console.log('  exec_sql RPC not available:', rpcErr.message);
    console.log('  → will need to run SQL via Supabase SQL Editor or psql.');
  } else {
    console.log('  exec_sql succeeded:', rpcData);
  }
})();
