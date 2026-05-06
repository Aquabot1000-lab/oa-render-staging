/**
 * Supabase Storage Service — Permanent file storage for OA
 * Replaces ephemeral Railway filesystem uploads
 * 
 * Bucket: 'documents' (public, already exists in Supabase)
 * Structure:
 *   notices/{case_id}/notice.ext
 *   agreements/{case_id}/agreement.ext
 *   evidence/{case_id}/evidence-packet.ext
 */

const { createClient } = require('@supabase/supabase-js');
const fsSync = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ylxreuqvofgbpsatfsvr.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let client = null;

function getClient() {
    if (!client) {
        if (!SUPABASE_SERVICE_KEY) {
            console.error('[Storage] No SUPABASE_SERVICE_ROLE_KEY — uploads will fall back to local');
            return null;
        }
        client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    }
    return client;
}

const BUCKET = 'documents';

/**
 * Upload a file to Supabase Storage
 * @param {Buffer|string} fileData - Buffer or local file path
 * @param {string} remotePath - e.g. 'notices/OA-0013/notice.pdf'
 * @param {string} contentType - MIME type
 * @returns {{ url: string, path: string } | null}
 */
async function uploadFile(fileData, remotePath, contentType) {
    const sb = getClient();
    if (!sb) return null;

    let buffer;
    if (typeof fileData === 'string') {
        buffer = fsSync.readFileSync(fileData);
    } else {
        buffer = fileData;
    }

    const { data, error } = await sb.storage
        .from(BUCKET)
        .upload(remotePath, buffer, { contentType, upsert: true });

    if (error) {
        console.error(`[Storage] Upload failed for ${remotePath}:`, error.message);
        return null;
    }

    const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(remotePath);
    const url = urlData?.publicUrl || `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${remotePath}`;

    console.log(`[Storage] ✅ Uploaded: ${remotePath}`);
    return { url, path: remotePath };
}

/**
 * Upload a notice file for a case.
 *
 * SAFETY: Uses unique timestamped filenames so customer uploads NEVER overwrite
 * each other. Path format: notices/{case_id}/{ISO-timestamp}_{slugified-original}.{ext}
 *
 * Why: Previous behavior used `notices/{caseId}/notice.{ext}` with `upsert:true`,
 * which destroyed prior uploads on every re-upload. Migration history (Tyler msg 30496):
 * the storage layer is now append-only for customer-facing uploads.
 */
async function uploadNotice(caseId, file) {
    const original = file.originalname || file.filename || 'notice.pdf';
    const ext = path.extname(original) || '.pdf';
    // Slugify base name: keep alnum + dash, collapse rest to '-', cap at 40 chars
    const baseRaw = path.basename(original, ext) || 'notice';
    const slug = baseRaw.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'notice';
    // ISO timestamp without ':' or '.' (filesystem-safe, sortable)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const remotePath = `notices/${caseId}/${stamp}_${slug}${ext}`;
    const source = file.buffer || file.path;

    // Use upsert:false so a path collision (extremely unlikely with timestamp) errors
    // instead of silently overwriting. uploadFile() defaults to upsert:true; override here.
    const sb = getClient();
    if (!sb) return null;
    let buffer;
    if (typeof source === 'string') {
        buffer = fsSync.readFileSync(source);
    } else {
        buffer = source;
    }
    const { error } = await sb.storage
        .from(BUCKET)
        .upload(remotePath, buffer, { contentType: file.mimetype || 'application/octet-stream', upsert: false });
    if (error) {
        console.error(`[Storage] Notice upload failed for ${remotePath}:`, error.message);
        return null;
    }
    const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(remotePath);
    const url = urlData?.publicUrl || `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${remotePath}`;
    console.log(`[Storage] ✅ Notice uploaded (append-only): ${remotePath}`);
    return { url, path: remotePath };
}

/**
 * Upload an agreement/signature for a case
 */
async function uploadAgreement(caseId, file) {
    const ext = path.extname(file.originalname || file.filename || '.pdf');
    const remotePath = `agreements/${caseId}/agreement${ext}`;
    const source = file.buffer || file.path;
    return uploadFile(source, remotePath, file.mimetype || 'application/octet-stream');
}

/**
 * Upload an evidence packet for a case
 */
async function uploadEvidence(caseId, filePath) {
    const ext = path.extname(filePath || '.pdf');
    const remotePath = `evidence/${caseId}/evidence-packet${ext}`;
    return uploadFile(filePath, remotePath, 'application/pdf');
}

/**
 * Get the permanent public URL for a stored file
 */
function getFileUrl(remotePath) {
    const sb = getClient();
    if (!sb) return null;
    const { data } = sb.storage.from(BUCKET).getPublicUrl(remotePath);
    return data?.publicUrl || null;
}

/**
 * Get a signed URL for a file in the evidence-export bucket
 * Evidence packets were uploaded to 'evidence-export' bucket, not 'documents'
 */
async function getEvidenceSignedUrl(caseId) {
    const sb = getClient();
    if (!sb) return null;
    
    // List files in the case folder
    const { data: files, error } = await sb.storage
        .from('evidence-export')
        .list(caseId, { limit: 10 });
    
    if (error || !files || files.length === 0) return null;
    
    // Find the evidence PDF (usually 'evidence.pdf' or similar)
    const pdfFile = files.find(f => f.name.endsWith('.pdf')) || files[0];
    if (!pdfFile) return null;
    
    const remotePath = `${caseId}/${pdfFile.name}`;
    const { data: signedData, error: signError } = await sb.storage
        .from('evidence-export')
        .createSignedUrl(remotePath, 3600); // 1 hour expiry
    
    if (signError) {
        console.error(`[Storage] Signed URL failed for ${remotePath}:`, signError.message);
        return null;
    }
    return signedData?.signedUrl || null;
}

/**
 * Delete a file from storage
 */
async function deleteFile(remotePath) {
    const sb = getClient();
    if (!sb) return false;
    const { error } = await sb.storage.from(BUCKET).remove([remotePath]);
    if (error) {
        console.error(`[Storage] Delete failed: ${error.message}`);
        return false;
    }
    return true;
}

module.exports = {
    uploadFile,
    uploadNotice,
    uploadAgreement,
    uploadEvidence,
    getFileUrl,
    getEvidenceSignedUrl,
    deleteFile,
    BUCKET
};
