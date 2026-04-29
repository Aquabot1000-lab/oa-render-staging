/**
 * Meta Lead Ads Webhook Handler
 * GET  /api/meta-leadgen — verification challenge
 * POST /api/meta-leadgen — leadgen event → forward to /api/intake
 *
 * Lead data strategy (in priority order):
 *   1. Fetch from Graph API if META_USER_ACCESS_TOKEN has leads_retrieval scope
 *   2. Fall back to field_data embedded in the webhook payload (if present)
 *   3. Log and ACK — Meta retries, so we never return non-200
 */

const express = require('express');
const router = express.Router();
const https = require('https');
const http = require('http');

const VERIFY_TOKEN = process.env.META_LEADGEN_VERIFY_TOKEN || '';
const META_USER_TOKEN = process.env.META_USER_ACCESS_TOKEN || '';
const META_APP_ID = process.env.META_APP_ID || '801704245709189';
const META_APP_SECRET = process.env.META_APP_SECRET || '';
const META_PAGE_ID = process.env.META_PAGE_ID || '1151563568032801';

// ── GET: Meta webhook verification handshake ──────────────────────────────
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('[MetaLeadgen] Verification ping received', { mode, token });

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[MetaLeadgen] Verified OK');
    return res.status(200).send(challenge);
  }
  console.warn('[MetaLeadgen] Verification FAILED — token mismatch');
  return res.sendStatus(403);
});

// ── POST: incoming leadgen event ──────────────────────────────────────────
router.post('/', express.json(), async (req, res) => {
  // Always ACK immediately — Meta requires 200 within 20s or it retries
  res.sendStatus(200);

  try {
    console.log('[MetaLeadgen] Webhook received:', JSON.stringify(req.body));

    const entry = (req.body.entry || [])[0];
    const change = ((entry && entry.changes) || [])[0];

    if (!change || change.field !== 'leadgen') {
      console.log('[MetaLeadgen] Not a leadgen event, ignoring');
      return;
    }

    const changeValue = change.value || {};
    const leadId = changeValue.leadgen_id;

    if (!leadId) {
      console.warn('[MetaLeadgen] No leadgen_id in payload');
      return;
    }

    console.log('[MetaLeadgen] Processing lead ID:', leadId);

    // Strategy 1: fetch full lead from Graph API
    let fields = {};
    try {
      const leadData = await fetchLead(leadId);
      if (leadData && !leadData.error && leadData.field_data) {
        console.log('[MetaLeadgen] Lead fetched from Graph API');
        (leadData.field_data || []).forEach(function(f) {
          fields[f.name] = (f.values || [])[0] || '';
        });
      } else if (leadData && leadData.error) {
        console.warn('[MetaLeadgen] Graph API error:', leadData.error.message);
      }
    } catch (fetchErr) {
      console.warn('[MetaLeadgen] Graph API fetch failed:', fetchErr.message);
    }

    // Strategy 2: use field_data embedded in webhook payload (test tool sends this)
    if (!fields['full_name'] && !fields['email'] && !fields['phone_number']) {
      const embeddedFields = changeValue.field_data || [];
      if (embeddedFields.length > 0) {
        console.log('[MetaLeadgen] Using embedded field_data from payload');
        embeddedFields.forEach(function(f) {
          fields[f.name] = (f.values || [])[0] || '';
        });
      }
    }

    // Determine if field_data is complete, partial, or missing
    const hasName    = !!(fields['full_name'] || fields['name']);
    const hasEmail   = !!fields['email'];
    const hasPhone   = !!(fields['phone_number'] || fields['phone']);
    const hasAddress = !!(fields['street_address'] || fields['address']);
    const isComplete = hasName && hasEmail && hasPhone;
    const isMissing  = !hasName && !hasEmail && !hasPhone;

    if (isMissing) {
      // Hard fallback: no field data at all — still create an INCOMPLETE record so no lead is lost
      console.warn('[MetaLeadgen] INCOMPLETE_META: No field data for lead ID:', leadId, '— creating fallback record');
      console.warn('[MetaLeadgen] Full payload:', JSON.stringify(changeValue));
    } else if (!isComplete) {
      console.warn('[MetaLeadgen] PARTIAL_META: Incomplete fields for lead ID:', leadId,
        '| name:', hasName, 'email:', hasEmail, 'phone:', hasPhone, 'address:', hasAddress);
    } else {
      console.log('[MetaLeadgen] Complete field_data received for lead ID:', leadId);
    }

    // Always build a record — incomplete fields get placeholder values so nothing is lost
    const incompleteFlag = isMissing ? 'INCOMPLETE_META' : (!isComplete ? 'PARTIAL_META' : null);

    const payload = {
      ownerName:       fields['full_name'] || fields['name'] || (incompleteFlag ? 'Meta Lead (incomplete)' : ''),
      email:           fields['email'] || (incompleteFlag ? `meta-fallback-${leadId}@overassessed-recover.com` : ''),
      phone:           fields['phone_number'] || fields['phone'] || (incompleteFlag ? '0000000000' : ''),
      propertyAddress: fields['street_address'] || fields['address'] || '',
      propertyType:    'residential',
      source:          incompleteFlag ? incompleteFlag : 'meta_lead_ad',
      utm_data: JSON.stringify({
        utm_source:    'facebook',
        utm_medium:    'paid',
        utm_campaign:  'tx-property-tax-protest',
        leadgen_id:    leadId,
        incomplete:    incompleteFlag || false
      })
    };

    if (incompleteFlag) {
      // Incomplete records bypass intake validation — write direct to Supabase
      console.log('[MetaLeadgen] Writing fallback record directly to Supabase, flag:', incompleteFlag);
      const saved = await saveIncompleteToSupabase({
        leadgen_id: leadId,
        page_id:    changeValue.page_id || '',
        form_id:    changeValue.form_id || '',
        raw_payload: JSON.stringify(changeValue),
        source:     incompleteFlag,
        created_at: new Date().toISOString()
      });
      if (saved.error) {
        console.error('[MetaLeadgen] Supabase fallback write failed:', JSON.stringify(saved.error));
      } else {
        console.log('[MetaLeadgen] Fallback record saved, id:', saved.id);
      }
      return;
    }

    console.log('[MetaLeadgen] Forwarding to /api/intake:', JSON.stringify(payload));

    const intakeResult = await postIntake(payload);
    console.log('[MetaLeadgen] /api/intake response:', intakeResult.status, intakeResult.body);

  } catch (err) {
    console.error('[MetaLeadgen] Unhandled error:', err.message);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────

// Validate token is not obviously expired via a quick debug_token check
async function isTokenValid(token) {
  if (!token || token.length < 20) return false;
  try {
    const result = await fetchJson(
      `https://graph.facebook.com/v19.0/debug_token?input_token=${encodeURIComponent(token)}&access_token=${META_APP_ID}|${META_APP_SECRET}`
    );
    return result.data && result.data.is_valid === true;
  } catch (e) {
    return false;
  }
}

// Get best available token: user token → page token from app credentials
async function getBestToken() {
  // Check if user token is actually valid (not just set)
  if (META_USER_TOKEN && await isTokenValid(META_USER_TOKEN)) {
    return META_USER_TOKEN;
  }
  // Fall back: derive page token from app credentials (non-expiring)
  if (META_APP_SECRET) {
    try {
      const appToken = await fetchJson(
        `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&grant_type=client_credentials`
      );
      if (appToken.access_token) {
        // Exchange for page token
        const pages = await fetchJson(
          `https://graph.facebook.com/v19.0/${META_PAGE_ID}?fields=access_token&access_token=${appToken.access_token}`
        );
        if (pages.access_token) {
          console.log('[MetaLeadgen] Using page-derived token');
          return pages.access_token;
        }
      }
    } catch (e) {
      console.warn('[MetaLeadgen] Page token derivation failed:', e.message);
    }
  }
  return META_USER_TOKEN;
}

function fetchJson(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

async function fetchLead(leadId) {
  const token = await getBestToken();
  const url = 'https://graph.facebook.com/v19.0/' + leadId +
    '?fields=field_data,created_time,ad_id,form_id&access_token=' +
    encodeURIComponent(token);
  return fetchJson(url);
}

// Write incomplete/missing field_data leads directly to Supabase
// Uses a dedicated meta_lead_fallbacks table (or submissions with stub values if table missing)
async function saveIncompleteToSupabase(data) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('[MetaLeadgen] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — cannot save fallback');
    return { error: 'missing supabase config' };
  }
  try {
    // Try meta_lead_fallbacks first; fall back to submissions with stub values
    const fallbackBody = JSON.stringify([data]);
    const r1 = await new Promise((resolve, reject) => {
      const url = new URL(supabaseUrl + '/rest/v1/meta_lead_fallbacks');
      const opts = {
        hostname: url.hostname, path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey,
          'Content-Type': 'application/json', 'Prefer': 'return=representation',
          'Content-Length': Buffer.byteLength(fallbackBody)
        }
      };
      const req = https.request(opts, res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => resolve({ status: res.statusCode, body: d }));
      });
      req.on('error', reject); req.write(fallbackBody); req.end();
    });
    if (r1.status < 300) {
      const rows = JSON.parse(r1.body);
      return { id: (rows[0] || {}).id || 'saved' };
    }
    // meta_lead_fallbacks table may not exist — fall back to submissions with stubs
    console.warn('[MetaLeadgen] meta_lead_fallbacks table unavailable (', r1.status, '), writing to submissions');
    // Generate a stub case_id for tracking
    const stubEmail = `incomplete-${data.leadgen_id}@meta-fallback.overassessed.ai`;
    const submBody = JSON.stringify([{
      owner_name:       'Meta Lead (incomplete)',
      email:            stubEmail,
      phone:            '0000000000',
      property_address: '',
      source:           data.source || 'INCOMPLETE_META',
      notes:            'Raw payload: ' + data.raw_payload,
      created_at:       data.created_at
    }]);
    const r2 = await new Promise((resolve, reject) => {
      const url = new URL(supabaseUrl + '/rest/v1/submissions');
      const opts = {
        hostname: url.hostname, path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'apikey': supabaseKey, 'Authorization': 'Bearer ' + supabaseKey,
          'Content-Type': 'application/json', 'Prefer': 'return=representation',
          'Content-Length': Buffer.byteLength(submBody)
        }
      };
      const req = https.request(opts, res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => resolve({ status: res.statusCode, body: d }));
      });
      req.on('error', reject); req.write(submBody); req.end();
    });
    if (r2.status < 300) {
      const rows = JSON.parse(r2.body);
      return { id: (rows[0] || {}).id || 'saved' };
    }
    return { error: 'submissions write failed: ' + r2.status + ' ' + r2.body.slice(0, 100) };
  } catch (err) {
    return { error: err.message };
  }
}

function postIntake(payload) {
  return new Promise(function(resolve, reject) {
    const body = JSON.stringify(payload);
    const options = {
      hostname: 'localhost',
      port: process.env.PORT || 3000,
      path: '/api/intake',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = http.request(options, function(intakeRes) {
      let data = '';
      intakeRes.on('data', function(chunk) { data += chunk; });
      intakeRes.on('end', function() { resolve({ status: intakeRes.statusCode, body: data }); });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = router;
