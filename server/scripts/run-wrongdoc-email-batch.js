#!/usr/bin/env node
/**
 * run-wrongdoc-email-batch.js
 * Tyler-approved 2026-04-27 07:50 CDT — email-only outreach for:
 *   WRONG_DOCUMENT: OA-0022, OA-0025, OA-0084
 *   PHONE-FAILED:   OA-0024, OA-0067, OA-0083, OA-0005
 *
 * Hard rules (this run):
 *   - email channel only
 *   - skip automation_excluded
 *   - skip duplicate (case, email) pairs (one human = one email even if multiple cases)
 *   - skip internal/non-customer emails (overassessed.ai)
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');
const sg = require('@sendgrid/mail');

const TARGETS = ['OA-0022','OA-0025','OA-0084','OA-0024','OA-0067','OA-0083','OA-0005'];

const SUBJECT = 'Need correct document to file your protest';
const HTML_BODY = (caseNum, uploadLink) => `
<p>Hi —</p>
<p>We're ready to file your 2026 property tax protest for case <strong>${caseNum}</strong>, but the document uploaded was not the Notice of Appraised Value.</p>
<p>Please upload your 2026 Notice of Appraised Value here:<br/>
<a href="${uploadLink}">${uploadLink}</a></p>
<p>Once uploaded, we will proceed immediately.</p>
<p>Thanks,<br/>OverAssessed</p>
`;

function uploadLinkFor(caseId) {
  const base = process.env.OA_PORTAL_URL || 'https://overassessed.ai';
  return `${base}/upload?case=${encodeURIComponent(caseId)}`;
}

(async () => {
  sg.setApiKey(process.env.SENDGRID_API_KEY);
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: subs } = await sb.from('submissions')
    .select('case_id,owner_name,email,upload_status,archived_at,do_not_contact,automation_excluded,state')
    .in('case_id', TARGETS);

  const seenEmails = new Set();
  const results = { sent: [], skipped: [], errors: [] };

  // Order = TARGETS order (so wrong-doc trio gets first crack at any shared email)
  const subsByCid = {};
  for (const s of subs) subsByCid[s.case_id] = s;

  for (const cid of TARGETS) {
    const s = subsByCid[cid];
    if (!s) { results.skipped.push({ cid, reason: 'not_found' }); continue; }

    const reasons = [];
    if (s.archived_at)         reasons.push('archived');
    if (s.do_not_contact)      reasons.push('DNC');
    if (s.automation_excluded) reasons.push('automation_excluded');
    if (s.state && s.state.toUpperCase() !== 'TX') reasons.push('out_of_tx');

    const email = (s.email || '').trim().toLowerCase();
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!valid)                                reasons.push('no_valid_email');
    if (email.endsWith('@overassessed.ai'))    reasons.push('internal_email');
    if (seenEmails.has(email))                 reasons.push('duplicate_email_already_sent_this_batch');

    if (reasons.length) { results.skipped.push({ cid, owner: s.owner_name, email: s.email, reason: reasons.join('+') }); continue; }

    const link = uploadLinkFor(cid);
    const html = HTML_BODY(cid, link);

    // Audit row first
    const { data: comm, error: commErr } = await sb.from('communications').insert({
      case_id:    cid,
      direction:  'outbound',
      channel:    'email',
      recipient:  email,
      subject:    SUBJECT,
      body:       html,
      status:     'queued',
      metadata:   { source: 'wrongdoc-email-batch', approved_by: 'tyler', approved_at: '2026-04-27T12:50:00Z', kind: 'wrong_doc_email' },
    }).select().single();
    if (commErr) { results.errors.push({ cid, error: commErr.message }); continue; }

    try {
      const r = await sg.send({
        to:      email,
        from:    { email: process.env.SENDGRID_FROM_EMAIL || 'team@overassessed.ai', name: 'OverAssessed' },
        subject: SUBJECT,
        html,
      });
      await sb.from('communications').update({ status: 'sent' }).eq('id', comm.id);
      results.sent.push({ cid, owner: s.owner_name, email, statusCode: r[0]?.statusCode });
      seenEmails.add(email);
    } catch (err) {
      await sb.from('communications').update({ status: 'failed', failure_reason: err.message }).eq('id', comm.id);
      results.errors.push({ cid, error: err.message, email });
    }

    // gentle rate-limit
    await new Promise(r => setTimeout(r, 400));
  }

  console.log(JSON.stringify({
    counts: {
      sent:    results.sent.length,
      skipped: results.skipped.length,
      errors:  results.errors.length,
    },
    sent:    results.sent,
    skipped: results.skipped,
    errors:  results.errors,
  }, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
