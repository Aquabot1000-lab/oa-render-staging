const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { supabaseAdmin, isSupabaseEnabled } = require('../lib/supabase');

// Local upload fallback (keep existing behavior)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

// GET /api/documents
router.get('/', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        let query = supabaseAdmin.from('documents').select('*, clients(name), appeals(case_id)');
        if (req.query.client_id) query = query.eq('client_id', req.query.client_id);
        if (req.query.appeal_id) query = query.eq('appeal_id', req.query.appeal_id);
        if (req.query.type) query = query.eq('type', req.query.type);
        const { data, error } = await query.order('uploaded_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/documents — upload a document to Supabase Storage
router.post('/', upload.single('file'), async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const { client_id, appeal_id, type } = req.body;
        if (!client_id) return res.status(400).json({ error: 'client_id required' });

        const docType = type || 'other';
        const timestamp = Date.now();
        const ext = path.extname(req.file.originalname);
        const storagePath = `${client_id}/${appeal_id || 'general'}/${timestamp}-${req.file.originalname}`;

        // Upload to Supabase Storage
        const { error: uploadErr } = await supabaseAdmin.storage
            .from('documents')
            .upload(storagePath, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: false
            });
        if (uploadErr) throw uploadErr;

        // Record in documents table
        const { data, error } = await supabaseAdmin
            .from('documents')
            .insert({
                client_id,
                appeal_id: appeal_id || null,
                type: docType,
                file_path: storagePath,
                file_name: req.file.originalname,
                storage_bucket: 'documents'
            })
            .select()
            .single();
        if (error) throw error;

        res.status(201).json(data);
    } catch (err) {
        console.error('[Documents] POST error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/documents/:id/download — get a signed URL for downloading
router.get('/:id/download', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        const { data: doc, error } = await supabaseAdmin
            .from('documents')
            .select('*')
            .eq('id', req.params.id)
            .single();
        if (error || !doc) return res.status(404).json({ error: 'Document not found' });

        const { data: urlData, error: urlErr } = await supabaseAdmin.storage
            .from(doc.storage_bucket)
            .createSignedUrl(doc.file_path, 3600); // 1 hour
        if (urlErr) throw urlErr;

        res.json({ url: urlData.signedUrl, fileName: doc.file_name });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/documents/:id
router.delete('/:id', async (req, res) => {
    if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });
    try {
        // Get doc info first
        const { data: doc } = await supabaseAdmin
            .from('documents')
            .select('*')
            .eq('id', req.params.id)
            .single();
        if (!doc) return res.status(404).json({ error: 'Document not found' });

        // Delete from storage
        await supabaseAdmin.storage.from(doc.storage_bucket).remove([doc.file_path]);

        // Delete record
        const { error } = await supabaseAdmin.from('documents').delete().eq('id', req.params.id);
        if (error) throw error;

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
