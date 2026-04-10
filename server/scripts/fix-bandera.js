require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
var { createClient } = require('@supabase/supabase-js');
var sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function go() {
  // Delete the incorrectly assigned 15103 Bandera Rd property
  // BCAD confirms: parcel 442522 = 707 Bandera Rd, owned by BANK ONE TEXAS NATIONAL ASSN
  // ArcGIS confirms: 15103 Bandera Rd = JESSICA INVESTMENTS LP — NOT Gabe Garcia
  var r = await sb.from('properties').delete().eq('id', 'c440c929-f06c-4df5-a438-6a56c5111ebf');
  if (r.error) { console.log('DELETE ERR:', r.error.message); }
  else { console.log('DELETED incorrect 15103 Bandera Rd property (was misattributed to Gabe Garcia)'); }

  // Verify remaining properties
  var props = await sb.from('properties').select('id, address, client_id, county, current_assessed_value, property_id_county').order('created_at');
  console.log('Remaining properties:');
  props.data.forEach(function(p) { console.log(JSON.stringify(p)); });
}
go();
