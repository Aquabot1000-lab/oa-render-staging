const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function advanceLeads() {
  const changes = [];

  // 1. Get leads in new_lead or analyzed stages
  const { data: leads, error: fetchErr } = await supabase
    .from('clients')
    .select('id, name, lead_stage, estimated_savings')
    .in('lead_stage', ['new_lead', 'analyzed']);

  if (fetchErr) { console.error('Fetch error:', JSON.stringify(fetchErr)); return; }
  if (!leads || leads.length === 0) { console.log('NO_REPLY'); return; }

  for (const lead of leads) {
    let newStage = null;

    if (lead.lead_stage === 'new_lead') {
      // Check if property data exists for this client
      const { data: props, error: propErr } = await supabase
        .from('properties')
        .select('id')
        .eq('client_id', lead.id)
        .limit(1);
      if (propErr) { console.error('Props error for', lead.id, JSON.stringify(propErr)); continue; }
      if (props && props.length > 0) {
        newStage = 'analyzed';
      }
    } else if (lead.lead_stage === 'analyzed' && lead.estimated_savings !== null) {
      // Advance to contacted in DB only — NO emails
      newStage = 'contacted';
    }

    if (newStage) {
      const now = new Date().toISOString();
      const { error: updateErr } = await supabase
        .from('clients')
        .update({ lead_stage: newStage, stage_updated_at: now })
        .eq('id', lead.id);

      if (updateErr) { console.error('Update error for', lead.id, JSON.stringify(updateErr)); continue; }

      // Log in lead_activity
      const { error: logErr } = await supabase
        .from('lead_activity')
        .insert({
          client_id: lead.id,
          activity_type: 'stage_change',
          from_stage: lead.lead_stage,
          to_stage: newStage,
          details: { automated: true, reason: 'Pipeline advancement cron' },
          created_by: 'aquabot'
        });

      if (logErr) console.error('Log error for', lead.id, JSON.stringify(logErr));
      else changes.push({ id: lead.id, name: lead.name, from: lead.lead_stage, to: newStage });
    }
  }

  if (changes.length > 0) {
    console.log(JSON.stringify({ message: 'OA Pipeline Lead Advancement', changes }, null, 2));
  } else {
    console.log('NO_REPLY');
  }
}

advanceLeads();
