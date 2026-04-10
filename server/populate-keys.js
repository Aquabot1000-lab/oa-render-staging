const { Client } = require('pg');
const DB = 'postgresql://postgres.ylxreuqvofgbpsatfsvr:h1AVVY1oXH9kJcwz@aws-0-us-west-2.pooler.supabase.com:5432/postgres';

async function run() {
  const client = new Client({ connectionString: DB, statement_timeout: 60000, keepAlive: true });
  await client.connect();

  // Check current state
  const { rows: state } = await client.query(
    "SELECT COUNT(*) AS total, COUNT(street_key) AS has_key FROM county_properties"
  );
  console.log('Current state:', state[0]);

  // Get counties ordered by size (smallest first for quick wins)
  const { rows: counties } = await client.query(
    "SELECT county, COUNT(*) AS cnt FROM county_properties WHERE street_key IS NULL GROUP BY county ORDER BY cnt ASC"
  );
  console.log(`Counties remaining: ${counties.length}`);
  if (counties.length === 0) { console.log('All done!'); await client.end(); return; }

  let totalUpdated = 0;
  const BATCH = 10000;

  for (const c of counties) {
    const county = c.county;
    const cnt = parseInt(c.cnt);
    let batchUpdated = 0;
    process.stdout.write(`${county} (${cnt})...`);

    while (true) {
      try {
        const res = await client.query(`
          UPDATE county_properties SET
            street_num = SPLIT_PART(TRIM(REPLACE(REPLACE(property_address, E'\\r\\n', ' '), E'\\r', '')), ' ', 1),
            street_key = UPPER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
              SPLIT_PART(REPLACE(REPLACE(property_address, E'\\r\\n', ', '), E'\\r', ''), ',', 1),
              '\\.', '', 'g'), '\\s+', ' ', 'g')))
          WHERE id IN (
            SELECT id FROM county_properties 
            WHERE county = $1 AND street_key IS NULL 
            LIMIT $2
          )
        `, [county, BATCH]);

        if (res.rowCount === 0) break;
        batchUpdated += res.rowCount;
        totalUpdated += res.rowCount;
        process.stdout.write(` +${res.rowCount}`);
      } catch (e) {
        console.error(`\n  ERR ${county}: ${e.message}`);
        // Reconnect
        try { await client.end(); } catch(_) {}
        const c2 = new Client({ connectionString: DB, statement_timeout: 60000, keepAlive: true });
        await c2.connect();
        Object.assign(client, c2);
        break;
      }
    }
    console.log(` = ${batchUpdated}`);
  }

  console.log(`\nTotal updated: ${totalUpdated}`);
  
  const { rows: check } = await client.query(
    "SELECT COUNT(*) AS total, COUNT(street_key) AS has_key, COUNT(street_num) AS has_num FROM county_properties"
  );
  console.log('Verification:', check[0]);

  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
