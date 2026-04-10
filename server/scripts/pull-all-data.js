require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
var { createClient } = require('@supabase/supabase-js');
var sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function go() {
  var cr = await sb.from('clients').select('id, name, email, phone, county, address, notes').order('created_at');
  if (cr.error) { console.log('CLIENT ERR:', cr.error.message); return; }
  var pr = await sb.from('properties').select('*').order('created_at');
  if (pr.error) { console.log('PROP ERR:', pr.error.message); return; }

  console.log('=== CLIENTS ===');
  cr.data.forEach(function(c) { console.log(JSON.stringify(c)); });
  console.log('\n=== PROPERTIES (full) ===');
  pr.data.forEach(function(p) {
    console.log(JSON.stringify({
      id: p.id,
      client_id: p.client_id,
      address: p.address,
      county: p.county,
      assessed: p.current_assessed_value,
      proposed: p.proposed_value,
      parcel: p.property_id_county,
      property_data: p.property_data,
      comp_results: p.comp_results
    }));
  });
}
go();
