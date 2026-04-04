const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // Get one row to see columns
  const { data, error } = await supabase.from('clients').select('*').limit(1);
  if (error) { console.error('Error:', JSON.stringify(error)); return; }
  if (data && data.length > 0) {
    console.log('Columns:', Object.keys(data[0]).join(', '));
    console.log('Sample:', JSON.stringify(data[0], null, 2));
  } else {
    console.log('No rows in clients table');
  }
  
  // Check if lead_activity table exists
  const { data: la, error: laErr } = await supabase.from('lead_activity').select('*').limit(1);
  if (laErr) console.log('lead_activity error:', JSON.stringify(laErr));
  else console.log('lead_activity exists, sample:', JSON.stringify(la));
}
run();
