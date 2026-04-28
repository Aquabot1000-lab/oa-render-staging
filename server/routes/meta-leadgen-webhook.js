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

    // If still no data, log and bail — Meta will retry
    if (!fields['email'] && !fields['full_name'] && !fields['phone_number']) {
      console.warn('[MetaLeadgen] No lead field data available for lead ID:', leadId);
      return;
    }

    const payload = {
      ownerName:       fields['full_name'] || fields['name'] || '',
      email:           fields['email'] || '',
      phone:           fields['phone_number'] || fields['phone'] || '',
      propertyAddress: fields['street_address'] || fields['address'] || '',
      propertyType:    'residential',
      source:          'meta_lead_ad',
      utm_data: JSON.stringify({
        utm_source:   'facebook',
        utm_medium:   'paid',
        utm_campaign: 'tx-property-tax-protest'
      })
    };

    console.log('[MetaLeadgen] Forwarding to /api/intake:', JSON.stringify(payload));

    const intakeResult = await postIntake(payload);
    console.log('[MetaLeadgen] /api/intake response:', intakeResult.status, intakeResult.body);

  } catch (err) {
    console.error('[MetaLeadgen] Unhandled error:', err.message);
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────

function fetchLead(leadId) {
  return new Promise(function(resolve, reject) {
    const url = 'https://graph.facebook.com/v19.0/' + leadId +
      '?fields=field_data,created_time,ad_id,form_id&access_token=' +
      encodeURIComponent(META_USER_TOKEN);
    https.get(url, function(apiRes) {
      let data = '';
      apiRes.on('data', function(chunk) { data += chunk; });
      apiRes.on('end', function() {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
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
