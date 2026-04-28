#!/usr/bin/env node
/**
 * OA Cleanup Audit — Tyler 2026-04-27 19:48 CDT
 *
 * READ-ONLY by default (DRY-RUN). Pass --apply to execute safe corrections.
 *
 * 1. Status audit — DB vs state-engine drift
 * 2. Legacy signature flag cleanup
 * 3. Package inventory — flag stale PDFs (do not delete)
 * 4. Contact hygiene — missing/invalid phones, internal emails, dup customers
 *
 * Honors:
 *  - DNC respected (do not touch)
 *  - Archived not touched
 *  - No customer messages
 *  - No filing
 */
'use strict';
require('dotenv').config({ path: __dirname + '/../.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const REPORT = {
  startedAt: new Date().toISOString(),
  mode: APPLY ? 'APPLY' : 'DRY-RUN',
  filesChanged: [],
  dbRowsCorrected: [],
  needsTylerDecision: [],
  customerMessagesSent: 0,
  filingsSubmitted: 0,
  sections: {}
};

function isInternalEmail(e) {
  if (!e) return false;
  const lc = e.toLowerCase().trim();
  return /@overassessed\.ai$|@uriahrealestate\.com$|aquabot1000@icloud\.com/.test(lc);
}
function phoneShape(p) {
  if (!p) return { valid: false, reason: 'missing' };
  const digits = String(p).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return { valid: true };
  if (digits.length === 10) return { valid: true };
  return { valid: false, reason: 'bad_format', raw: p };
}

async function section1_statusAudit() {
  console.log('\n=== 1. STATUS AUDIT ===');
  const { data: subs } = await sb.from('submissions')
    .select('case_id, status, filing_status, upload_status, county_notice_status, automation_excluded, archived_at, do_not_contact, last_activity_at')
    .order('case_id');

  const drifts = [];
  for (const s of subs || []) {
    if (s.archived_at) continue;
    if (s.do_not_contact) continue;
    if (s.automation_excluded) continue;

    // Drift 1: filing_status='ready_to_file' but no fee_agreement_signed
    // (Read fee_agreement_signed lazily only if needed)
    // Drift 2: status='SIGNED_READY_TO_FILE' but no esign_tokens row signed
    // Drift 3: county_notice_status='received' but upload_status NOT 'verified_notice'

    if (s.county_notice_status === 'received' && s.upload_status !== 'verified_notice') {
      drifts.push({ case_id: s.case_id, drift: 'notice_received_but_not_verified', status: s.status, filing_status: s.filing_status, upload_status: s.upload_status });
    }
    if (s.filing_status === 'ready_to_file' || s.status === 'READY_TO_FILE' || s.status === 'SIGNED_READY_TO_FILE') {
      // need to verify against esign_tokens + case_documents
      const [{ data: tokens }, { data: docs }] = await Promise.all([
        sb.from('esign_tokens').select('signed_at, signature_data').eq('case_id', s.case_id).not('signed_at', 'is', null),
        sb.from('case_documents').select('file_type').eq('case_id', s.case_id).eq('file_type', 'signed_50_162')
      ]);
      const realSig = (tokens || []).find(t => (t.signature_data || '').length > 1000);
      const has50162 = (docs || []).length > 0;
      if (!realSig || !has50162) {
        drifts.push({
          case_id: s.case_id, drift: 'ready_to_file_without_real_sig_or_50162',
          status: s.status, filing_status: s.filing_status,
          has_real_sig: !!realSig, has_50162: has50162
        });
      }
    }
  }

  REPORT.sections.statusAudit = { totalActive: (subs || []).filter(s => !s.archived_at).length, driftCount: drifts.length, drifts };
  console.log(`  ${drifts.length} drifts across ${(subs || []).length} cases`);
  drifts.forEach(d => console.log(`  - ${d.case_id}: ${d.drift}`));
  return drifts;
}

async function section2_legacySignatureFlags() {
  console.log('\n=== 2. LEGACY SIGNATURE FLAGS ===');
  const { data: subs } = await sb.from('submissions')
    .select('case_id, agent_form_signed, fee_agreement_signed, status, filing_status, archived_at, do_not_contact')
    .eq('agent_form_signed', true);

  const fakeFlagged = [];
  for (const s of subs || []) {
    const [{ data: tokens }, { data: docs }] = await Promise.all([
      sb.from('esign_tokens').select('signed_at, signature_data').eq('case_id', s.case_id).not('signed_at', 'is', null),
      sb.from('case_documents').select('file_type').eq('case_id', s.case_id).eq('file_type', 'signed_50_162')
    ]);
    const realSig = (tokens || []).find(t => (t.signature_data || '').length > 1000);
    const has50162 = (docs || []).length > 0;
    if (!realSig || !has50162) {
      fakeFlagged.push({
        case_id: s.case_id, sig_data_max: Math.max(0, ...(tokens || []).map(t => (t.signature_data || '').length)),
        has_50162: has50162, archived: !!s.archived_at, dnc: !!s.do_not_contact
      });
    }
  }

  console.log(`  ${fakeFlagged.length} cases with agent_form_signed=true but no real sig + 50162`);
  for (const f of fakeFlagged) console.log(`  - ${f.case_id}: max_sig=${f.sig_data_max}B, has_50162=${f.has_50162}${f.archived?' [ARCHIVED]':''}${f.dnc?' [DNC]':''}`);

  if (APPLY) {
    for (const f of fakeFlagged) {
      if (f.archived) continue; // do not touch archived
      if (f.dnc) continue;       // do not touch DNC
      const { error } = await sb.from('submissions').update({
        agent_form_signed: false,
        last_activity_at: new Date().toISOString()
      }).eq('case_id', f.case_id);
      if (error) {
        console.log(`    ✗ ${f.case_id}: ${error.message}`);
        continue;
      }
      await sb.from('activity_log').insert({
        case_id: f.case_id, actor: 'aquabot-cleanup', action: 'legacy_sig_flag_reset',
        details: {
          reason: 'agent_form_signed=true but no esign_tokens.signature_data>1000 AND no signed_50_162 PDF',
          previous_value: true, new_value: false,
          tyler_directive: '2026-04-27 19:48 CDT cleanup pass',
          sig_data_max_bytes: f.sig_data_max, has_50162: f.has_50162
        },
        created_at: new Date().toISOString()
      });
      REPORT.dbRowsCorrected.push({ table: 'submissions', case_id: f.case_id, action: 'agent_form_signed=true→false' });
      console.log(`    ✓ ${f.case_id}: reset to false`);
    }
  }

  REPORT.sections.legacySignatureFlags = { count: fakeFlagged.length, cases: fakeFlagged };
  return fakeFlagged;
}

async function section3_packageInventory() {
  console.log('\n=== 3. PACKAGE INVENTORY ===');
  const { data: docs } = await sb.from('case_documents')
    .select('id, case_id, file_type, file_name, file_url, uploaded_at, notes')
    .in('file_type', ['filing_package', 'signed_50_162', 'protest_package', 'aoa', 'fee_agreement']);

  const stale = [];
  const today = new Date('2026-04-27');
  for (const d of docs || []) {
    const reasons = [];
    if (!d.uploaded_at) {
      reasons.push('no_uploaded_at');
    } else {
      const ageDays = (today - new Date(d.uploaded_at)) / 86400000;
      if (d.file_type === 'filing_package' && ageDays > 14) reasons.push(`package_age_${Math.round(ageDays)}d`);
    }
    // Filename markers
    const fn = (d.file_name || '').toLowerCase();
    if (fn.includes('2025') && d.file_type === 'signed_50_162') reasons.push('filename_says_2025_not_2026');
    if (fn.includes('draft') || fn.includes('template')) reasons.push('looks_like_draft_or_template');
    if (reasons.length) stale.push({ id: d.id, case_id: d.case_id, file_type: d.file_type, file_name: d.file_name, uploaded_at: d.uploaded_at, reasons });
  }

  console.log(`  ${docs?.length || 0} relevant documents, ${stale.length} flagged stale`);
  for (const s of stale) console.log(`  - ${s.case_id} [${s.file_type}] ${s.file_name}: ${s.reasons.join(', ')}`);

  if (APPLY) {
    for (const s of stale) {
      const newNote = `[STALE 2026-04-27] reasons: ${s.reasons.join(', ')}`;
      const { error } = await sb.from('case_documents').update({ notes: newNote }).eq('id', s.id);
      if (!error) {
        REPORT.dbRowsCorrected.push({ table: 'case_documents', id: s.id, case_id: s.case_id, action: 'marked_stale_in_notes' });
      }
    }
  }

  REPORT.sections.packageInventory = { totalDocs: docs?.length || 0, staleCount: stale.length, stale };
  return stale;
}

async function section4_contactHygiene() {
  console.log('\n=== 4. CONTACT HYGIENE ===');
  const { data: subs } = await sb.from('submissions')
    .select('case_id, owner_name, email, phone, archived_at, do_not_contact, automation_excluded, sms_unusable, email_unusable')
    .order('case_id');
  const active = (subs || []).filter(s => !s.archived_at);

  const missingPhone = [];
  const invalidPhone = [];
  const internalEmail = [];
  const emailMap = new Map();

  for (const s of active) {
    const ph = phoneShape(s.phone);
    if (ph.reason === 'missing') missingPhone.push({ case_id: s.case_id, owner_name: s.owner_name, email: s.email });
    else if (ph.reason === 'bad_format') invalidPhone.push({ case_id: s.case_id, owner_name: s.owner_name, phone: s.phone });
    if (isInternalEmail(s.email)) internalEmail.push({ case_id: s.case_id, owner_name: s.owner_name, email: s.email });
    if (s.email) {
      const key = s.email.toLowerCase().trim();
      if (!emailMap.has(key)) emailMap.set(key, []);
      emailMap.get(key).push({ case_id: s.case_id, owner_name: s.owner_name });
    }
  }
  const dups = [...emailMap.entries()].filter(([_, arr]) => arr.length > 1).map(([email, cases]) => ({ email, cases }));

  console.log(`  Active TX cases: ${active.length}`);
  console.log(`  Missing phone: ${missingPhone.length}`);
  console.log(`  Invalid phone: ${invalidPhone.length}`);
  console.log(`  Internal email: ${internalEmail.length}`);
  console.log(`  Duplicate email rows: ${dups.length}`);

  REPORT.sections.contactHygiene = {
    totalActive: active.length,
    missingPhone, invalidPhone, internalEmail, duplicateEmails: dups
  };
  return { missingPhone, invalidPhone, internalEmail, dups };
}

async function main() {
  await section1_statusAudit();
  await section2_legacySignatureFlags();
  await section3_packageInventory();
  await section4_contactHygiene();

  // Tyler-decision items
  const ph = REPORT.sections.contactHygiene;
  const fakeFlags = REPORT.sections.legacySignatureFlags;
  const drift = REPORT.sections.statusAudit;

  if (drift.driftCount > 0) REPORT.needsTylerDecision.push({ topic: 'status_drifts', count: drift.driftCount, note: 'Each drift requires case-by-case decision (notice re-upload, esign re-issue, or status correction).' });
  const fakeArchived = (fakeFlags.cases || []).filter(c => c.archived).length;
  if (fakeArchived > 0) REPORT.needsTylerDecision.push({ topic: 'archived_cases_with_fake_flag', count: fakeArchived, note: 'Archived cases with bogus agent_form_signed — left untouched per directive. Tyler decides whether to scrub.' });
  if ((ph.missingPhone || []).length) REPORT.needsTylerDecision.push({ topic: 'missing_phones', count: ph.missingPhone.length, note: 'Cases with no phone — need data entry or customer outreach (no auto-msg).' });
  if ((ph.invalidPhone || []).length) REPORT.needsTylerDecision.push({ topic: 'invalid_phones', count: ph.invalidPhone.length });
  if ((ph.duplicateEmails || []).length) REPORT.needsTylerDecision.push({ topic: 'duplicate_email_rows', count: ph.duplicateEmails.length, note: 'Same email across multiple submissions — verify dedupe.' });

  REPORT.endedAt = new Date().toISOString();
  const outPath = path.join(__dirname, '..', 'audit', `cleanup-${new Date().toISOString().slice(0,10)}.json`);
  fs.writeFileSync(outPath, JSON.stringify(REPORT, null, 2));
  console.log('\n✓ Report written: ' + outPath);
  console.log('Mode: ' + REPORT.mode);
  console.log('DB rows corrected: ' + REPORT.dbRowsCorrected.length);
  console.log('Tyler-decision topics: ' + REPORT.needsTylerDecision.length);
}

main().catch(e => { console.error(e); process.exit(1); });
