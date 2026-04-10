// v2: Use id-range batching instead of WHERE street_key IS NULL LIMIT
// This avoids the sequential scan for NULL that slows down as rows fill up
const { Client } = require('pg');
const DB = 'postgresql://postgres.ylxreuqvofgbpsatfsvr:h1AVVY1oXH9kJcwz@aws-0-us-west-2.pooler.supabase.com:5432/postgres';

async function run() {
  const client = new Client({ connectionString: DB, statement_timeout: 120000, keepAlive: true });
  await client.connect();

  // Get min/max id for rows still needing update
  const { rows: [range] } = await client.query(
    "SELECT MIN(id) AS min_id, MAX(id) AS max_id, COUNT(*) AS remaining FROM county_properties WHERE street_key IS NULL"
  );
  console.log('Range:', range);
  
  if (!range.min_id) { console.log('All done!'); await client.end(); return; }

  let cursor = parseInt(range.min_id);
  const maxId = parseInt(range.max_id);
  const BATCH = 20000; // id range per batch
  let totalUpdated = 0;
  const startTime = Date.now();

  while (cursor <= maxId) {
    const batchEnd = cursor + BATCH;
    try {
      const res = await client.query(`
        UPDATE county_properties SET
          street_num = SPLIT_PART(TRIM(REPLACE(REPLACE(property_address, E'\\r\\n', ' '), E'\\r', '')), ' ', 1),
          street_key = UPPER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
            SPLIT_PART(REPLACE(REPLACE(property_address, E'\\r\\n', ', '), E'\\r', ''), ',', 1),
            '\\.', '', 'g'), '\\s+', ' ', 'g')))
        WHERE id >= $1 AND id < $2 AND street_key IS NULL
      `, [cursor, batchEnd]);

      totalUpdated += res.rowCount;
      if (res.rowCount > 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const pct = ((cursor - parseInt(range.min_id)) / (maxId - parseInt(range.min_id)) * 100).toFixed(1);
        process.stdout.write(`[${elapsed}s] ${pct}% | id ${cursor}-${batchEnd} | +${res.rowCount} (total: ${totalUpdated})\n`);
      }
    } catch (e) {
      console.error(`ERR at id ${cursor}: ${e.message}`);
      // Reconnect
      try { await client.end(); } catch(_) {}
      const c2 = new Client({ connectionString: DB, statement_timeout: 120000, keepAlive: true });
      await c2.connect();
      Object.assign(client, c2);
    }
    cursor = batchEnd;
  }

  console.log(`\nDone! Total updated: ${totalUpdated}`);
  
  const { rows: check } = await client.query(
    "SELECT COUNT(*) AS total, COUNT(street_key) AS has_key FROM county_properties"
  );
  console.log('Final:', check[0]);

  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
