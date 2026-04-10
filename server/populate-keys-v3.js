// v3: Use ctid-based batching for UUID tables
// ctid = (page_number, tuple_number) — physical row location, fast for range scans
const { Client } = require('pg');
const DB = 'postgresql://postgres.ylxreuqvofgbpsatfsvr:h1AVVY1oXH9kJcwz@aws-0-us-west-2.pooler.supabase.com:5432/postgres';

async function run() {
  const client = new Client({ connectionString: DB, statement_timeout: 120000, keepAlive: true });
  await client.connect();

  // Get remaining counties
  const { rows: counties } = await client.query(`
    SELECT county, COUNT(*) AS cnt 
    FROM county_properties WHERE street_key IS NULL 
    GROUP BY county ORDER BY cnt ASC
  `);
  
  console.log(`Remaining: ${counties.map(c => `${c.county}(${c.cnt})`).join(', ')}`);
  let totalUpdated = 0;
  const startTime = Date.now();

  for (const c of counties) {
    const county = c.county;
    let batchTotal = 0;
    process.stdout.write(`\n${county} (${c.cnt})...`);

    // Fetch IDs in batches then update by ID list
    while (true) {
      // Get a batch of IDs (fast: hits the pkey index)
      const { rows: ids } = await client.query(`
        SELECT id FROM county_properties 
        WHERE county = $1 AND street_key IS NULL 
        LIMIT 5000
      `, [county]);

      if (ids.length === 0) break;

      const idList = ids.map(r => r.id);
      
      const res = await client.query(`
        UPDATE county_properties SET
          street_num = SPLIT_PART(TRIM(REPLACE(REPLACE(property_address, E'\\r\\n', ' '), E'\\r', '')), ' ', 1),
          street_key = UPPER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
            SPLIT_PART(REPLACE(REPLACE(property_address, E'\\r\\n', ', '), E'\\r', ''), ',', 1),
            '\\.', '', 'g'), '\\s+', ' ', 'g')))
        WHERE id = ANY($1::uuid[])
      `, [idList]);

      batchTotal += res.rowCount;
      totalUpdated += res.rowCount;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      process.stdout.write(` +${res.rowCount}[${elapsed}s]`);
    }
    console.log(` = ${batchTotal}`);
  }

  console.log(`\nTotal updated: ${totalUpdated}`);
  const { rows: check } = await client.query(
    "SELECT COUNT(*) AS total, COUNT(street_key) AS has_key FROM county_properties"
  );
  console.log('Final:', check[0]);
  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
