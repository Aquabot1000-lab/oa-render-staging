#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://ylxreuqvofgbpsatfsvr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlseHJldXF2b2ZnYnBzYXRmc3ZyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg1NzE4MCwiZXhwIjoyMDg3NDMzMTgwfQ.DxTv7ZC0oNRHBBS0Jxquh1M0wsGV8fQ005Q9S2iILdE';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const BUCKET = 'evidence-export';

const REMAINING = ['OA-0016','OA-0019','OA-0021','OA-0023'];

async function main() {
    for (const cid of REMAINING) {
        const localPath = path.join(__dirname, '..', 'evidence-packets', `${cid}-Evidence-Packet.pdf`);
        const fileBuffer = fs.readFileSync(localPath);
        const storagePath = `${cid}/evidence.pdf`;
        
        await supabase.storage.from(BUCKET).remove([storagePath]);
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, fileBuffer, { contentType: 'application/pdf', upsert: true });
        if (upErr) { console.log(`${cid}: UPLOAD FAIL — ${upErr.message}`); continue; }
        
        const { data: urlData } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 7*24*60*60);
        const signedUrl = urlData?.signedUrl;
        
        let accessible = false;
        try { const r = await fetch(signedUrl, { method: 'HEAD' }); accessible = r.ok; } catch(e) {}
        
        // Update DB
        const { data: rows } = await supabase.from('submissions').select('id, verified_analysis').eq('case_id', cid).is('deleted_at', null).single();
        if (rows) {
            const va = { ...rows.verified_analysis, evidence_url: signedUrl, evidence_generated_at: new Date().toISOString() };
            await supabase.from('submissions').update({ verified_analysis: va }).eq('id', rows.id);
        }
        
        console.log(`${cid}: ${fileBuffer.length}B | uploaded: YES | accessible: ${accessible} | DB updated`);
    }
}
main().catch(err => console.error('FATAL:', err));
