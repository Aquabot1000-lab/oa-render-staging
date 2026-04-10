require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
var { createClient } = require('@supabase/supabase-js');
var sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function go() {
  var r = await sb.from('pre_registrations').select('*').order('created_at');
  if (r.error) { console.log('ERR:', r.error.message); return; }
  console.log('Total pre_registrations:', r.data.length);
  r.data.forEach(function(p) { console.log(JSON.stringify({name:p.name, email:p.email, phone:p.phone, address:p.address, county:p.county, status:p.status})); });
}
go();
