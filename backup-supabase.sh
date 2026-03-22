#!/bin/bash
# Supabase backup using Node.js (more reliable than curl)
cd /Users/aquabot/Documents/OverAssessed/server

BACKUP_DIR="/Users/aquabot/Documents/OverAssessed/backups"
DATE=$(date +%Y-%m-%d)
LOG="$BACKUP_DIR/$DATE.log"
OUTPUT="$BACKUP_DIR/$DATE.json"

mkdir -p "$BACKUP_DIR"

node -e "
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const supabase = createClient(
  'https://ylxreuqvofgbpsatfsvr.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || fs.readFileSync('.env','utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1]?.trim()
);

const tables = ['submissions','clients','properties','appeals','documents','payments','exemptions','referrals','case_counter'];
const backup = {};
let totalRecords = 0;
let failures = [];

(async () => {
  for (const table of tables) {
    try {
      const { data, error } = await supabase.from(table).select('*');
      if (error) { failures.push(table + ': ' + error.message); continue; }
      backup[table] = data;
      totalRecords += (data || []).length;
      console.error('✅ ' + table + ': ' + (data || []).length + ' records');
    } catch(e) {
      failures.push(table + ': ' + e.message);
      console.error('❌ ' + table + ': ' + e.message);
    }
  }
  
  fs.writeFileSync('$OUTPUT', JSON.stringify(backup, null, 2));
  const size = fs.statSync('$OUTPUT').size;
  console.error('Total: ' + totalRecords + ' records, ' + Math.round(size/1024) + 'KB');
  if (failures.length) console.error('Failures: ' + failures.join(', '));
  else console.error('All tables backed up successfully ✅');
})();
" 2>"$LOG"

echo "Backup complete. See $LOG"
