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
 * Upload a notice file for a case
 */
async function uploadNotice(caseId, file) {
    const ext = path.extname(file.originalname || file.filename || '.pdf');
    const remotePath = `notices/${caseId}/notice${ext}`;
    const source = file.buffer || file.path;
    return uploadFile(source, remotePath, file.mimetype || 'application/octet-stream');
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
    deleteFile,
    BUCKET
};
