const express = require('express');
const router = express.Router();
const { supabaseAdmin, isSupabaseEnabled } = require('../lib/supabase');

// ─── STAGE DEFINITIONS ───
const STAGES = {
  incomplete: { order: 0, label: 'Incomplete', auto: ['request_missing_info'] },
  new_lead:   { order: 1, label: 'New Lead',   auto: ['analyze_property'] },
  analyzed:   { order: 2, label: 'Analyzed',   auto: ['send_welcome_email'] },
  contacted:  { order: 3, label: 'Contacted',  auto: ['schedule_followups'] },
  engaged:    { order: 4, label: 'Engaged',    auto: ['send_fee_agreement'] },
  signed:     { order: 5, label: 'Signed',     auto: ['create_appeal'] },
  filed:      { order: 6, label: 'Filed',      auto: ['monitor_status'] },
  closed:     { order: 7, label: 'Closed',     auto: ['send_win_email', 'request_review'] },
};

// ─── FOLLOW-UP SCHEDULE (days after contact) ───
const FOLLOW_UP_SCHEDULE = [
  { day: 0, type: 'email', template: 'welcome' },
  { day: 2, type: 'email', template: 'value_prop' },
  { day: 5, type: 'email', template: 'social_proof' },
  { day: 7, type: 'sms',   template: 'quick_check' },
  { day: 10, type: 'email', template: 'deadline_urgency' },
  { day: 14, type: 'email', template: 'last_chance' },
  { day: 21, type: 'email', template: 'long_term_nurture' },
];

// ─── ESCALATION RULES ───
function shouldEscalate(client, property) {
  const reasons = [];
  // High-value property (assessed > $500K)
  if (property?.current_assessed_value > 500000) {
    reasons.push(`High-value property: $${property.current_assessed_value.toLocaleString()}`);
  }
  // Estimated savings > $2,000
  if (client.estimated_savings > 2000) {
    reasons.push(`High estimated savings: $${client.estimated_savings}`);
  }
  // Stalled in 'contacted' for 7+ days
  if (client.lead_stage === 'contacted') {
    const daysSinceUpdate = (Date.now() - new Date(client.stage_updated_at)) / 86400000;
    if (daysSinceUpdate > 7) {
      reasons.push(`Stalled in contacted for ${Math.floor(daysSinceUpdate)} days`);
    }
  }
  // Engaged but not signed after 5 days
  if (client.lead_stage === 'engaged') {
    const daysSinceUpdate = (Date.now() - new Date(client.stage_updated_at)) / 86400000;
    if (daysSinceUpdate > 5) {
      reasons.push(`Engaged but not signed after ${Math.floor(daysSinceUpdate)} days`);
    }
  }
  return reasons.length > 0 ? reasons : null;
}

// ─── GET /api/pipeline/metrics ───
router.get('/metrics', async (req, res) => {
  if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
  try {
    const { data: metrics, error: e1 } = await supabaseAdmin.rpc('get_pipeline_metrics').select('*');
    
    // Fallback: manual query if view/rpc not set up
    const { data: clients, error: e2 } = await supabaseAdmin
      .from('clients')
      .select('lead_stage, estimated_savings, lead_score, priority, created_at, stage_updated_at')
      .neq('lead_stage', 'admin');
    
    if (e2) throw e2;

    const stages = {};
    let total = 0;
    for (const c of clients || []) {
      const stage = c.lead_stage || 'new_lead';
      if (!stages[stage]) stages[stage] = { count: 0, total_savings: 0 };
      stages[stage].count++;
      stages[stage].total_savings += parseFloat(c.estimated_savings || 0);
      total++;
    }

    // Calculate conversion rates
    const funnel = {
      total_leads: total,
      by_stage: Object.entries(STAGES).map(([key, val]) => ({
        stage: key,
        label: val.label,
        count: stages[key]?.count || 0,
        pct: total > 0 ? Math.round(((stages[key]?.count || 0) / total) * 100) : 0,
        avg_savings: stages[key]?.count > 0 
          ? Math.round(stages[key].total_savings / stages[key].count) 
          : 0,
      })),
      conversion_rates: {
        lead_to_contact: calcRate(stages, ['contacted','engaged','signed','filed','closed'], total),
        contact_to_engaged: calcRate(stages, ['engaged','signed','filed','closed'], 
          sumStages(stages, ['contacted','engaged','signed','filed','closed'])),
        engaged_to_signed: calcRate(stages, ['signed','filed','closed'],
          sumStages(stages, ['engaged','signed','filed','closed'])),
        overall_close: calcRate(stages, ['signed','filed','closed'], total),
      }
    };

    res.json(funnel);
  } catch (err) {
    console.error('[Pipeline] metrics error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function sumStages(stages, keys) {
  return keys.reduce((sum, k) => sum + (stages[k]?.count || 0), 0);
}

function calcRate(stages, numeratorStages, denominator) {
  const num = sumStages(stages, numeratorStages);
  return denominator > 0 ? Math.round((num / denominator) * 100) : 0;
}

// ─── POST /api/pipeline/advance ───
// Move a client to the next stage
router.post('/advance', async (req, res) => {
  if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
  try {
    const { client_id, to_stage, notes } = req.body;
    if (!client_id || !to_stage) return res.status(400).json({ error: 'client_id and to_stage required' });
    if (!STAGES[to_stage]) return res.status(400).json({ error: `Invalid stage: ${to_stage}` });

    // ─── STAGE ORDER ENFORCEMENT ───
    // Stages must follow order: new_lead → analyzed → contacted → engaged → signed → filed → closed
    // Cannot skip stages (except admin override via force=true)
    const STAGE_ORDER = ['new_lead', 'analyzed', 'contacted', 'engaged', 'signed', 'filed', 'closed'];

    // Get current client
    const { data: client, error: fetchErr } = await supabaseAdmin
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();
    if (fetchErr) throw fetchErr;
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const from_stage = client.lead_stage || 'new_lead';

    // Enforce stage order (no skipping)
    const fromIdx = STAGE_ORDER.indexOf(from_stage);
    const toIdx = STAGE_ORDER.indexOf(to_stage);
    if (!req.body.force && toIdx > fromIdx + 1) {
      const nextStage = STAGE_ORDER[fromIdx + 1];
      return res.status(400).json({ 
        error: `Cannot skip stages. Current: ${from_stage}, requested: ${to_stage}. Next allowed: ${nextStage}`,
        next_allowed: nextStage
      });
    }

    // Enforce analyzed requirements
    if (to_stage === 'contacted' && from_stage === 'analyzed') {
      if (!client.estimated_savings && client.estimated_savings !== 0) {
        return res.status(400).json({ error: 'Cannot advance to contacted: estimated_savings required' });
      }
      if (!client.lead_score && client.lead_score !== 0) {
        return res.status(400).json({ error: 'Cannot advance to contacted: lead_score required' });
      }
      if (!client.priority) {
        return res.status(400).json({ error: 'Cannot advance to contacted: priority required' });
      }
    }

    // Update client stage
    const updateData = {
      lead_stage: to_stage,
      stage_updated_at: new Date().toISOString(),
    };
    
    // Set timestamp fields
    if (to_stage === 'contacted' && !client.first_contacted_at) {
      updateData.first_contacted_at = new Date().toISOString();
    }
    if (to_stage === 'signed') updateData.signed_at = new Date().toISOString();
    if (to_stage === 'filed') updateData.filed_at = new Date().toISOString();
    if (to_stage === 'closed') updateData.closed_at = new Date().toISOString();

    const { error: updateErr } = await supabaseAdmin
      .from('clients')
      .update(updateData)
      .eq('id', client_id);
    if (updateErr) throw updateErr;

    // Log activity
    await supabaseAdmin.from('lead_activity').insert({
      client_id,
      activity_type: 'stage_change',
      from_stage,
      to_stage,
      details: { notes: notes || null, automated_actions: STAGES[to_stage].auto },
      created_by: 'aquabot',
    });

    // Schedule follow-ups if moving to 'contacted'
    if (to_stage === 'contacted') {
      const followUps = FOLLOW_UP_SCHEDULE.map(f => ({
        client_id,
        scheduled_at: new Date(Date.now() + f.day * 86400000).toISOString(),
        follow_up_type: f.type,
        template_key: f.template,
        status: 'pending',
      }));
      await supabaseAdmin.from('follow_up_schedule').insert(followUps);
    }

    res.json({ 
      success: true, 
      from_stage, 
      to_stage, 
      automated_actions: STAGES[to_stage].auto 
    });
  } catch (err) {
    console.error('[Pipeline] advance error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/pipeline/followups ───
// Get pending follow-ups (for cron to process)
router.get('/followups', async (req, res) => {
  if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
  try {
    const { data, error } = await supabaseAdmin
      .from('follow_up_schedule')
      .select('*, clients(name, email, phone, lead_stage)')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[Pipeline] followups error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/pipeline/escalations ───
// Check for leads that need executive attention
router.get('/escalations', async (req, res) => {
  if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
  try {
    const { data: clients, error } = await supabaseAdmin
      .from('clients')
      .select('*, properties(*)')
      .in('lead_stage', ['new_lead', 'contacted', 'engaged', 'analyzed'])
      .order('stage_updated_at', { ascending: true });
    if (error) throw error;

    const escalations = [];
    for (const client of clients || []) {
      const property = client.properties?.[0];
      const reasons = shouldEscalate(client, property);
      if (reasons) {
        escalations.push({
          client_id: client.id,
          name: client.name,
          email: client.email,
          stage: client.lead_stage,
          days_in_stage: Math.floor((Date.now() - new Date(client.stage_updated_at)) / 86400000),
          estimated_savings: client.estimated_savings,
          property_value: property?.current_assessed_value,
          reasons,
        });
      }
    }

    res.json(escalations);
  } catch (err) {
    console.error('[Pipeline] escalations error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/pipeline/log ───
// Log any activity against a client
router.post('/log', async (req, res) => {
  if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
  try {
    const { client_id, activity_type, details, created_by } = req.body;
    if (!client_id || !activity_type) {
      return res.status(400).json({ error: 'client_id and activity_type required' });
    }

    const { data, error } = await supabaseAdmin
      .from('lead_activity')
      .insert({
        client_id,
        activity_type,
        details: details || {},
        created_by: created_by || 'system',
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error('[Pipeline] log error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/pipeline/activity/:clientId ───
router.get('/activity/:clientId', async (req, res) => {
  if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
  try {
    const { data, error } = await supabaseAdmin
      .from('lead_activity')
      .select('*')
      .eq('client_id', req.params.clientId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[Pipeline] activity error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/pipeline/validate-intake ───
// Validate a lead has required data, mark incomplete if missing
router.post('/validate-intake', async (req, res) => {
  if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
  try {
    const { client_id } = req.body;
    if (!client_id) return res.status(400).json({ error: 'client_id required' });

    // Get client + properties
    const { data: client, error: fetchErr } = await supabaseAdmin
      .from('clients')
      .select('*, properties(*)')
      .eq('id', client_id)
      .single();
    if (fetchErr) throw fetchErr;
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const missing = [];
    
    // Check required: name
    if (!client.name || client.name.trim() === '') missing.push('name');
    
    // Check required: email or phone
    if ((!client.email || client.email.includes('pending@')) && !client.phone) {
      missing.push('email_or_phone');
    }
    
    // Check required: property address (street + city + state minimum)
    const prop = client.properties?.[0];
    const hasAddress = client.address || prop?.address;
    const hasCity = client.city || prop?.city;
    const hasState = client.state || prop?.state;
    
    if (!hasAddress) missing.push('property_address');
    if (!hasCity) missing.push('city');
    if (!hasState) missing.push('state');

    // Update client with validation result
    if (missing.length > 0) {
      await supabaseAdmin.from('clients').update({
        lead_stage: 'incomplete',
        missing_fields: missing,
        stage_updated_at: new Date().toISOString(),
      }).eq('id', client_id);

      await supabaseAdmin.from('lead_activity').insert({
        client_id,
        activity_type: 'note_added',
        details: { action: 'intake_validation_failed', missing_fields: missing },
        created_by: 'system',
      });

      return res.json({ 
        valid: false, 
        stage: 'incomplete', 
        missing_fields: missing,
        action: 'Request missing info from lead'
      });
    }

    // Valid — ensure in new_lead (not incomplete)
    if (client.lead_stage === 'incomplete') {
      await supabaseAdmin.from('clients').update({
        lead_stage: 'new_lead',
        missing_fields: [],
        stage_updated_at: new Date().toISOString(),
      }).eq('id', client_id);
    }

    res.json({ valid: true, stage: 'new_lead', missing_fields: [] });
  } catch (err) {
    console.error('[Pipeline] validate-intake error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/pipeline/incomplete ───
// List all incomplete leads with what's missing
router.get('/incomplete', async (req, res) => {
  if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
  try {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('id, name, email, phone, address, city, state, county, missing_fields, enrichment_attempted, created_at')
      .eq('lead_stage', 'incomplete')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[Pipeline] incomplete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
