/**
 * safe-doc-write.js
 * Hardened case_documents writer with retry, verification, activity log, and Telegram alert.
 */
const https = require('https');

async function verifiyUrl(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            await new Promise((resolve, reject) => {
                const req = https.request(url, { method: 'HEAD' }, res => {
                    if (res.statusCode === 200) resolve();
                    else reject(new Error(`HTTP ${res.statusCode}`));
                });
                req.on('error', reject);
                req.setTimeout(5000, () => req.destroy(new Error('timeout')));
                req.end();
            });
            return true;
        } catch (e) {
            if (i === retries - 1) throw e;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

async function safeCaseDocWrite(supabaseAdmin, docRow, { sendTelegramAlert, caseId } = {}) {
    const MAX_RETRIES = 2;
    let lastErr;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const { error } = await supabaseAdmin
                .from('case_documents')
                .upsert(docRow, { onConflict: 'case_id,file_type' });
            if (error) throw new Error(error.message);

            // Verify URL is reachable
            if (docRow.file_url) {
                await verifiyUrl(docRow.file_url);
            }

            // Log success
            await supabaseAdmin.from('activity_log').insert({
                case_id: caseId || docRow.case_id,
                actor: 'system',
                action: 'document_stored',
                details: { file_name: docRow.file_name, file_url: docRow.file_url, attempt }
            }).catch(() => {});

            return { ok: true, attempt };
        } catch (e) {
            lastErr = e;
            console.error(`[SafeDocWrite] Attempt ${attempt} failed for ${docRow.case_id}: ${e.message}`);
            if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 1500));
        }
    }

    // Both attempts failed — flag case and alert
    const errMsg = `DOCUMENT_ERROR on ${docRow.case_id}: ${lastErr.message}`;

    await supabaseAdmin.from('submissions')
        .update({ status: 'DOCUMENT_ERROR', updated_at: new Date().toISOString() })
        .eq('case_id', docRow.case_id)
        .catch(() => {});

    await supabaseAdmin.from('activity_log').insert({
        case_id: caseId || docRow.case_id,
        actor: 'system',
        action: 'document_error',
        details: { error: lastErr.message, file_name: docRow.file_name }
    }).catch(() => {});

    if (typeof sendTelegramAlert === 'function') {
        await sendTelegramAlert(`🚨 <b>DOCUMENT_ERROR</b>\nCase: ${docRow.case_id}\nFile: ${docRow.file_name}\nError: ${lastErr.message}`).catch(() => {});
    }

    throw new Error(errMsg);
}

module.exports = { safeCaseDocWrite, verifiyUrl };
