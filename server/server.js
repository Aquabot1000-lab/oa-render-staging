const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const twilio = require('twilio');
const sgMail = require('@sendgrid/mail');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// RentCast analysis service
const { runRentCastAnalysis, getComps: getRentCastComps } = require('./services/rentcast');

// Real Comp Engine (no synthetic data)
const { fetchRealComps, fetchRealCompsBatch } = require('./services/real-comp-engine');

// Analysis services
const { fetchPropertyData } = require('./services/property-data');
const { findComparables } = require('./services/comp-engine');
const { generateEvidencePacket, EVIDENCE_DIR } = require('./services/evidence-generator');
const { prepareFilingPackage, FILING_DIR } = require('./services/auto-file');
const { detectState, sendStageNotification } = require('./services/notifications');

// Tarrant County real property data
const tarrantData = require('./services/tarrant-data');

const app = express();
const PORT = process.env.PORT || 3002;

// Supabase routes (new database layer - runs alongside existing file-based routes)
const { isSupabaseEnabled, supabaseAdmin } = require('./lib/supabase');
const { normalizeAddress, normalizeStreet, addressesMatch } = require('./lib/normalize-address');
const { validateIntakeFields } = require('./lib/validate-input');
const clientsRouter = require('./routes/clients');
const propertiesRouter = require('./routes/properties');
const appealsRouter = require('./routes/appeals');
const documentsRouter = require('./routes/documents');
const paymentsRouter = require('./routes/payments');
const exemptionsRouter = require('./routes/exemptions');
const referralsRouter = require('./routes/referrals');
const filingsRouter = require('./routes/filings');
const stripeRouter = require('./routes/stripe');
const coinbaseRouter = require('./routes/coinbase');
const emailNurtureRouter = require('./routes/email-nurture');
const uriCommissionsRouter = require('./routes/uri-commissions');
const pipelineRouter = require('./routes/pipeline');
const { checkAllPendingOutcomes } = require('./services/outcome-monitor');

// Twilio setup
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

// SendGrid setup
// 🚨 OA EMAIL KILL SWITCH — set by Tyler 2026-04-03
// ALL outbound OA customer emails PAUSED. Only internal logging active.
const OA_EMAIL_KILLED = true;
if (process.env.SENDGRID_API_KEY && !OA_EMAIL_KILLED) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
    console.log('[OA EMAIL] ⛔ Kill switch active — SendGrid NOT initialized');
}

// File upload setup
const uploadsDir = path.join(__dirname, 'uploads');
const noticesDir = path.join(__dirname, 'uploads', 'notices');
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        await fs.mkdir(uploadsDir, { recursive: true });
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const noticeStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
        await fs.mkdir(noticesDir, { recursive: true });
        cb(null, noticesDir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadNotice = multer({ storage: noticeStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// Middleware

// Redirect www to non-www (fixes Google Search Console 5xx on www.overassessed.ai)
app.use((req, res, next) => {
    if (req.hostname && req.hostname.startsWith('www.')) {
        const newHost = req.hostname.slice(4);
        return res.redirect(301, `https://${newHost}${req.originalUrl}`);
    }
    next();
});

// Remove trailing slashes EXCEPT for /blog/ (which needs index.html)
// Fixes "alternate page with proper canonical" in GSC
app.use((req, res, next) => {
    if (req.path !== '/' && req.path.endsWith('/') && !req.path.startsWith('/api/') && req.path !== '/blog/') {
        const query = req.url.slice(req.path.length);
        const safePath = req.path.slice(0, -1).replace(/\/+/g, '/');
        return res.redirect(301, safePath + query);
    }
    next();
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadsDir));
app.use('/evidence-packets', express.static(path.join(__dirname, 'evidence-packets')));
app.use('/filing-packages', express.static(path.join(__dirname, 'filing-packages')));
app.use('/generated-forms', express.static(path.join(__dirname, 'generated-forms')));
app.use('/data/automation-screenshots', express.static(path.join(__dirname, '..', 'data', 'automation-screenshots')));
// Serve images with correct MIME types
const imageStaticOptions = {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
    if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) res.setHeader('Content-Type', 'image/jpeg');
    if (filePath.endsWith('.webp')) res.setHeader('Content-Type', 'image/webp');
    if (filePath.endsWith('.gif')) res.setHeader('Content-Type', 'image/gif');
  }
};
app.use('/marketing/social-media/images', express.static(path.join(__dirname, '..', 'marketing', 'social-media', 'images'), imageStaticOptions));
app.use('/tiktok', express.static(path.join(__dirname, '..', 'tiktok'), imageStaticOptions));
app.use('/marketing/tiktok-images', express.static(path.join(__dirname, '..', 'marketing', 'tiktok-images'), imageStaticOptions));
app.use('/marketing/tiktok-images-v2', express.static(path.join(__dirname, '..', 'marketing', 'tiktok-images-v2'), imageStaticOptions));
app.use('/assets', express.static(path.join(__dirname, '..', 'assets'), imageStaticOptions));
// TikTok domain verification (MUST be before express.static)
app.get('/tiktokKIXW8kcCOw9dYhRPnYsy10Xqz1VGsZUD.txt', (req, res) => {
    res.type('text/plain').send('tiktok-developers-site-verification=KIXW8kcCOw9dYhRPnYsy10Xqz1VGsZUD');
});
app.get('/tiktokcxwnOBPxlyRnGiscjSfbKV1mMPTGSABj.txt', (req, res) => {
    res.type('text/plain').send('tiktok-developers-site-verification=cxwnOBPxlyRnGiscjSfbKV1mMPTGSABj');
});
app.get('/tiktokLoFc44Nvwbs1cHB7Oom7sVDCqlMd6dch.txt', (req, res) => {
    res.type('text/plain').send('tiktok-developers-site-verification=LoFc44Nvwbs1cHB7Oom7sVDCqlMd6dch\n');
});
// Also serve without extension just in case
app.get('/tiktokLoFc44Nvwbs1cHB7Oom7sVDCqlMd6dch', (req, res) => {
    res.type('text/plain').send('tiktok-developers-site-verification=LoFc44Nvwbs1cHB7Oom7sVDCqlMd6dch\n');
});

// ===== INSTANT SAVINGS ESTIMATOR =====
// Simple rate limiter for /api/estimate (max 10 requests per hour per IP)
const estimateRateLimiter = new Map();
const ESTIMATE_RATE_LIMIT = 10;

// === PRICING CONFIG (single source of truth) ===
const PRICING = {
    STANDARD_RATE: 0.25,      // 25% for all new customers
    LEGACY_RATE: 0.20,        // 20% only for explicitly flagged legacy customers
    INITIATION_FEE: 79,       // $79 initiation fee
    // To apply legacy rate, set fee_rate=0.20 AND pricing_locked=true on the case
    // Never hardcode percentages in content — always reference PRICING.STANDARD_RATE
};
const ESTIMATE_RATE_WINDOW = 60 * 60 * 1000; // 1 hour

app.post('/api/estimate', async (req, res) => {
    const clientIp = req.ip || req.connection.remoteAddress;

    // Rate limiting
    const now = Date.now();
    if (!estimateRateLimiter.has(clientIp)) {
        estimateRateLimiter.set(clientIp, []);
    }
    const timestamps = estimateRateLimiter.get(clientIp).filter(t => now - t < ESTIMATE_RATE_WINDOW);
    if (timestamps.length >= ESTIMATE_RATE_LIMIT) {
        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    timestamps.push(now);
    estimateRateLimiter.set(clientIp, timestamps);

    try {
        const { address, state, county, parcelNumber } = req.body;

        if (!state || !county) {
            return res.status(400).json({ error: 'State and county are required.' });
        }

        if (!address && !parcelNumber) {
            return res.status(400).json({ error: 'Either address or parcel number is required.' });
        }

        // Build a lightweight case data object
        const caseData = {
            propertyAddress: address || `Parcel ${parcelNumber}`,
            state: state,
            county: county,
            parcelNumber: parcelNumber || null
        };

        console.log(`[Estimator] Processing request: ${address || parcelNumber}, ${county}, ${state}`);

        // Fetch property data (with retry for timeout-prone CAD lookups)
        let propertyData;
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                propertyData = await fetchPropertyData(caseData);
                if (propertyData && propertyData.source !== 'intake-fallback') break; // Got real data
                if (attempt < 2) {
                    console.log(`[Estimator] Attempt ${attempt} got fallback, retrying...`);
                    await new Promise(r => setTimeout(r, 2000));
                }
            } catch (error) {
                console.error(`[Estimator] Property data fetch failed (attempt ${attempt}):`, error.message);
                if (attempt >= 2) {
                    return res.json({
                        error: 'We couldn\'t find property data for this address. Please verify the information and try again, or contact us for assistance.'
                    });
                }
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        if (!propertyData || !propertyData.assessedValue) {
            return res.json({
                error: 'Property data is incomplete. Please verify your address or parcel number and try again.'
            });
        }

        // Reject fallback/estimated data for the public estimator - only show real CAD values
        if (propertyData.source === 'intake-fallback') {
            console.warn('[Estimator] Rejecting fallback data - CAD lookup timed out or failed');
            return res.json({
                error: 'Our property lookup is taking longer than expected. Please try again in a moment, or contact us for a free personalized analysis.'
            });
        }

        // Fast-path for local bulk data: use quick E&U estimate without full comp engine
        // This avoids BIS network calls for comps and returns instantly
        const { getCountyData: getLocalData } = require('./services/local-parcel-data');
        const localCountyData = getLocalData(caseData.county || 'bexar');
        
        let analysis = null;
        if (propertyData.source === 'local-bulk' && localCountyData.isLoaded()) {
            // Quick E&U analysis using local comps
            const targetRecord = localCountyData.searchByAddress(address || parcelNumber || '')[0];
            if (targetRecord) {
                const comps = localCountyData.findComps(targetRecord, { maxComps: 10, maxValueDiff: 0.4 });
                if (comps.length >= 3) {
                    // Calculate median comp value per sqft for E&U
                    const compValues = comps
                        .filter(c => c.appraisedValue > 0)
                        .map(c => c.appraisedValue)
                        .sort((a, b) => a - b);
                    const medianValue = compValues[Math.floor(compValues.length / 2)];
                    const recommendedValue = Math.min(propertyData.assessedValue, medianValue);
                    
                    analysis = {
                        recommendedValue,
                        comps: comps.slice(0, 5),
                        effectiveTaxRate: 0.023,
                        euAnalysis: { valid: comps.length >= 5 }
                    };
                    console.log(`[Estimator] Quick local analysis: ${comps.length} comps, median ${medianValue}, recommended ${recommendedValue}`);
                }
            }
        }
        
        // Full comp engine as fallback
        if (!analysis) {
            try {
                analysis = await findComparables(propertyData, caseData);
            } catch (error) {
                console.error('[Estimator] Comp analysis failed:', error.message);
                // If local data available, return a conservative estimate
                if (propertyData.source === 'local-bulk') {
                    const conservativeReduction = Math.round(propertyData.assessedValue * 0.08);
                    return res.json({
                        currentAssessed: propertyData.assessedValue,
                        recommendedValue: propertyData.assessedValue - conservativeReduction,
                        estimatedReduction: conservativeReduction,
                        estimatedSavings: Math.round(conservativeReduction * 0.023),
                        taxRate: 0.023,
                        compsFound: 0,
                        strategy: 'Preliminary Estimate'
                    });
                }
                return res.json({
                    error: 'We encountered an issue analyzing comparable properties. Please try again or contact us for help.'
                });
            }
        }

        if (!analysis || !analysis.recommendedValue) {
            // Conservative estimate if comps failed but we have property data
            if (propertyData.assessedValue > 0) {
                const conservativeReduction = Math.round(propertyData.assessedValue * 0.08);
                return res.json({
                    currentAssessed: propertyData.assessedValue,
                    recommendedValue: propertyData.assessedValue - conservativeReduction,
                    estimatedReduction: conservativeReduction,
                    estimatedSavings: Math.round(conservativeReduction * 0.023),
                    taxRate: 0.023,
                    compsFound: 0,
                    strategy: 'Preliminary Estimate'
                });
            }
            return res.json({
                error: 'Unable to calculate a recommended value at this time. Our team can help - please reach out!'
            });
        }

        // Calculate savings
        const currentAssessed = propertyData.assessedValue;
        const recommendedValue = analysis.recommendedValue;
        const reduction = Math.max(0, currentAssessed - recommendedValue);
        const taxRate = analysis.effectiveTaxRate || 0.023; // Default ~2.3%
        const estimatedSavings = Math.round(reduction * taxRate);

        // Determine strategy
        let strategy = 'Market Value Analysis';
        if (analysis.euAnalysis && analysis.euAnalysis.valid) {
            strategy = 'Equal & Uniform Analysis';
        }

        // Return results
        return res.json({
            currentAssessed,
            recommendedValue,
            estimatedReduction: reduction,
            estimatedSavings,
            taxRate,
            compsFound: analysis.comps ? analysis.comps.length : 0,
            strategy
        });

    } catch (error) {
        console.error('[Estimator] Unexpected error:', error);
        return res.status(500).json({
            error: 'An unexpected error occurred. Please try again or contact us for assistance.'
        });
    }
});

app.use(express.static(path.join(__dirname, '..'), { index: false }));

// File paths
const DATA_DIR = path.join(__dirname, 'data');
const TX_DIR = path.join(DATA_DIR, 'tx');
const GA_DIR = path.join(DATA_DIR, 'ga');
const SHARED_DIR = path.join(DATA_DIR, 'shared');
const TX_SUBMISSIONS_FILE = path.join(TX_DIR, 'submissions.json');
const GA_SUBMISSIONS_FILE = path.join(GA_DIR, 'submissions.json');
const LEGACY_SUBMISSIONS_FILE = path.join(__dirname, 'submissions.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const COUNTER_FILE = path.join(__dirname, 'counter.json');

// Helper: build Supabase .or() filter that handles both UUID ids and case_id strings
function buildIdFilter(value) {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    if (isUUID) return `id.eq.${value},case_id.eq.${value.toUpperCase()}`;
    return `case_id.eq.${(value || '').toUpperCase()}`;
}

function getSubmissionsFile(state) {
    return state === 'GA' ? GA_SUBMISSIONS_FILE : TX_SUBMISSIONS_FILE;
}

// ==================== SUPABASE SUBMISSION HELPERS ====================
// Maps camelCase JS objects ↔ snake_case DB columns
function submissionToRow(sub) {
    return {
        id: sub.id,
        case_id: sub.caseId,
        property_address: sub.propertyAddress,
        property_type: sub.propertyType,
        owner_name: sub.ownerName,
        phone: sub.phone,
        email: sub.email,
        assessed_value: sub.assessedValue,
        state: sub.state,
        county: sub.county,
        notification_pref: sub.notificationPref,
        bedrooms: sub.bedrooms,
        bathrooms: sub.bathrooms,
        sqft: sub.sqft,
        year_built: sub.yearBuilt,
        renovations: sub.renovations,
        renovation_desc: sub.renovationDesc,
        condition_issues: sub.conditionIssues,
        condition_desc: sub.conditionDesc,
        recent_appraisal: sub.recentAppraisal,
        appraised_value: sub.appraisedValue,
        appraisal_date: sub.appraisalDate,
        notice_file: sub.noticeFile,
        notice_of_value: sub.noticeOfValue,
        source: sub.source,
        utm_data: sub.utm_data,
        status: sub.status,
        notes: sub.notes,
        savings: sub.savings,
        estimated_savings: sub.estimatedSavings,
        analysis_report: sub.analysisReport,
        analysis_status: sub.analysisStatus,
        property_data: sub.propertyData,
        comp_results: sub.compResults,
        evidence_packet_path: sub.evidencePacketPath,
        filing_data: sub.filingData,
        needs_manual_review: sub.needsManualReview,
        review_reason: sub.reviewReason,
        signature: sub.signature,
        fee_agreement_signature: sub.feeAgreementSignature || null,
        fee_agreement_signed: sub.fee_agreement_signed || false,
        fee_agreement_signed_at: sub.fee_agreement_signed_at || null,
        pin: sub.pin,
        drip_state: sub.dripState,
        referral_code: sub.referralCode,
        discounted_rate: sub.discountedRate,
        fee_rate: sub.feeRate || 0.25,
        referral_credit: sub.referralCredit || null,
        referral_id: sub.referralId,
        stripe_customer_id: sub.stripeCustomerId,
        created_at: sub.createdAt,
        updated_at: sub.updatedAt,
        deleted_at: sub.deletedAt || null,
        follow_up_date: sub.followUpDate || null,
        follow_up_note: sub.followUpNote || null
    };
}

function rowToSubmission(row) {
    return {
        id: row.id,
        caseId: row.case_id,
        propertyAddress: row.property_address,
        propertyType: row.property_type,
        ownerName: row.owner_name,
        phone: row.phone,
        email: row.email,
        assessedValue: row.assessed_value,
        state: row.state,
        county: row.county,
        notificationPref: row.notification_pref,
        bedrooms: row.bedrooms,
        bathrooms: row.bathrooms,
        sqft: row.sqft,
        yearBuilt: row.year_built,
        renovations: row.renovations,
        renovationDesc: row.renovation_desc,
        conditionIssues: row.condition_issues,
        conditionDesc: row.condition_desc,
        recentAppraisal: row.recent_appraisal,
        appraisedValue: row.appraised_value,
        appraisalDate: row.appraisal_date,
        noticeFile: row.notice_file,
        noticeOfValue: row.notice_of_value,
        source: row.source,
        utm_data: row.utm_data,
        status: row.status,
        notes: row.notes || [],
        savings: row.savings,
        estimatedSavings: row.estimated_savings,
        analysisReport: row.analysis_report,
        analysisStatus: row.analysis_status,
        propertyData: row.property_data,
        compResults: row.comp_results,
        evidencePacketPath: row.evidence_packet_path,
        filingData: row.filing_data,
        needsManualReview: row.needs_manual_review,
        reviewReason: row.review_reason,
        signature: row.signature,
        feeAgreementSignature: row.fee_agreement_signature || row.feeAgreementSignature || null,
        fee_agreement_signed: row.fee_agreement_signed || false,
        fee_agreement_signed_at: row.fee_agreement_signed_at || null,
        pin: row.pin,
        dripState: row.drip_state,
        referralCode: row.referral_code,
        discountedRate: row.discounted_rate,
        feeRate: row.fee_rate || 0.25,
        referralCredit: row.referral_credit || null,
        referralId: row.referral_id,
        stripeCustomerId: row.stripe_customer_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        deletedAt: row.deleted_at || null,
        followUpDate: row.follow_up_date || null,
        followUpNote: row.follow_up_note || null,
        // Contacted follow-up fields (stored in drip_state.contacted)
        contactedDrip: row.drip_state?.contacted || null,
        customerReplied: row.follow_up_note?.includes('Customer replied') || false,
        followUpStage: row.follow_up_note?.startsWith('Stage: ') ? row.follow_up_note.replace('Stage: ', '') : null,
        firstContactedAt: row.drip_state?.firstContactedAt || null,
        stageUpdatedAt: row.updated_at
    };
}

// Read all submissions - Supabase primary, file fallback
// By default filters out soft-deleted records; pass includeDeleted=true to get everything
async function readAllSubmissions(includeDeleted = false) {
    if (isSupabaseEnabled()) {
        try {
            let query = supabaseAdmin
                .from('submissions')
                .select('*')
                .order('created_at', { ascending: false });
            if (!includeDeleted) {
                query = query.is('deleted_at', null);
            }
            const { data, error } = await query;
            if (error) throw error;
            return (data || []).map(rowToSubmission);
        } catch (err) {
            console.error('[Submissions] Supabase read failed, falling back to files:', err.message);
        }
    }
    // Fallback to local JSON
    const [tx, ga] = await Promise.all([
        readJsonFile(TX_SUBMISSIONS_FILE),
        readJsonFile(GA_SUBMISSIONS_FILE)
    ]);
    return [...tx, ...ga];
}

// Write (upsert) a submission - Supabase primary, JSON always (dual-write for safety)
async function writeSubmission(submission) {
    let supabaseOk = false;
    if (isSupabaseEnabled()) {
        try {
            const row = submissionToRow(submission);
            const { error } = await supabaseAdmin
                .from('submissions')
                .upsert(row, { onConflict: 'id' });
            if (error) throw error;
            supabaseOk = true;
        } catch (err) {
            console.error('[Submissions] Supabase write failed:', err.message);
        }
    }
    // Always write to local JSON as backup (best-effort)
    try {
        const file = getSubmissionsFile(submission.state || 'TX');
        const submissions = await readJsonFile(file);
        const idx = submissions.findIndex(s => s.id === submission.id);
        if (idx >= 0) {
            submissions[idx] = submission;
        } else {
            submissions.push(submission);
        }
        await writeJsonFile(file, submissions);
    } catch (jsonErr) {
        if (!supabaseOk) {
            // Both failed - this is critical
            console.error('[Submissions] CRITICAL: Both Supabase and JSON write failed!', jsonErr.message);
            throw jsonErr;
        }
        console.warn('[Submissions] JSON backup write failed (Supabase OK):', jsonErr.message);
    }
}

// Update submission in place - Supabase primary, file fallback
async function updateSubmissionInPlace(submissionId, updater) {
    if (isSupabaseEnabled()) {
        try {
            // Fetch from Supabase
            let query = supabaseAdmin.from('submissions').select('*');
            const { data: rows, error: fetchErr } = await query
                .or(buildIdFilter(submissionId));
            if (fetchErr) throw fetchErr;
            if (rows && rows.length > 0) {
                const row = rows[0];
                const submissions = [rowToSubmission(row)];
                updater(submissions, 0);
                const updated = submissions[0];
                updated.updatedAt = updated.updatedAt || new Date().toISOString();
                const { error: upErr } = await supabaseAdmin
                    .from('submissions')
                    .update(submissionToRow(updated))
                    .eq('id', row.id);
                if (upErr) throw upErr;
                return updated;
            }
            return null;
        } catch (err) {
            console.error('[Submissions] Supabase update failed, falling back to files:', err.message);
        }
    }
    // Fallback to local JSON
    for (const file of [TX_SUBMISSIONS_FILE, GA_SUBMISSIONS_FILE]) {
        const submissions = await readJsonFile(file);
        const idx = submissions.findIndex(s => s.id === submissionId || s.caseId === (submissionId || '').toUpperCase());
        if (idx >= 0) {
            updater(submissions, idx);
            await writeJsonFile(file, submissions);
            return submissions[idx];
        }
    }
    return null;
}

// Find a submission across both state files
async function findSubmission(idOrCaseId) {
    if (isSupabaseEnabled()) {
        try {
            const { data: rows, error } = await supabaseAdmin
                .from('submissions')
                .select('*')
                .or(buildIdFilter(idOrCaseId));
            if (error) throw error;
            if (rows && rows.length > 0) return rowToSubmission(rows[0]);
            return null;
        } catch (err) {
            console.error('[Submissions] Supabase find failed, falling back to files:', err.message);
        }
    }
    const all = await readAllSubmissions();
    return all.find(s => s.id === idOrCaseId || s.caseId === (idOrCaseId || '').toUpperCase()) || null;
}

// Initialize data files
async function initializeDataFiles() {
    // Ensure data directories exist
    await fs.mkdir(TX_DIR, { recursive: true });
    await fs.mkdir(GA_DIR, { recursive: true });
    await fs.mkdir(SHARED_DIR, { recursive: true });
    await fs.mkdir(path.join(TX_DIR, 'evidence-packets'), { recursive: true });
    await fs.mkdir(path.join(TX_DIR, 'filing-packages'), { recursive: true });
    await fs.mkdir(path.join(GA_DIR, 'evidence-packets'), { recursive: true });
    await fs.mkdir(path.join(GA_DIR, 'filing-packages'), { recursive: true });

    try { await fs.access(TX_SUBMISSIONS_FILE); } catch { await fs.writeFile(TX_SUBMISSIONS_FILE, '[]'); }
    try { await fs.access(GA_SUBMISSIONS_FILE); } catch { await fs.writeFile(GA_SUBMISSIONS_FILE, '[]'); }
    try { await fs.access(COUNTER_FILE); } catch { await fs.writeFile(COUNTER_FILE, JSON.stringify({ lastCaseNumber: 0 })); }

    // Migrate legacy submissions.json to TX if it exists
    try {
        await fs.access(LEGACY_SUBMISSIONS_FILE);
        const legacyData = await readJsonFile(LEGACY_SUBMISSIONS_FILE);
        if (legacyData.length > 0) {
            const existingTx = await readJsonFile(TX_SUBMISSIONS_FILE);
            if (existingTx.length === 0) {
                // Tag all legacy submissions as TX
                const tagged = legacyData.map(s => ({ ...s, state: s.state || 'TX' }));
                await writeJsonFile(TX_SUBMISSIONS_FILE, tagged);
                console.log(`[Migration] Migrated ${tagged.length} legacy submissions to TX`);
                // Rename old file as backup
                await fs.rename(LEGACY_SUBMISSIONS_FILE, LEGACY_SUBMISSIONS_FILE + '.bak');
            }
        }
    } catch { /* no legacy file, fine */ }
    // Always reset admin user on boot to ensure known credentials
    {
        const hashedPassword = await bcrypt.hash('OverAssessed!2026', 10);
        const defaultUser = {
            id: uuidv4(),
            email: 'tyler@overassessed.ai',
            password: hashedPassword,
            name: 'Tyler Worthey',
            role: 'admin',
            createdAt: new Date().toISOString()
        };
        await fs.writeFile(USERS_FILE, JSON.stringify([defaultUser], null, 2));
        console.log('[Init] Admin user reset - tyler@overassessed.ai / OverAssessed!2026');
    }
    await fs.mkdir(noticesDir, { recursive: true });
}

// Helpers
async function readJsonFile(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch { return []; }
}

async function writeJsonFile(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function getNextCaseId() {
    // Try Supabase first to get max case number (survives Railway restarts)
    if (isSupabaseEnabled()) {
        try {
            const { data, error } = await supabaseAdmin
                .from('submissions')
                .select('case_id')
                .order('created_at', { ascending: false })
                .limit(1);
            if (!error && data && data.length > 0) {
                const match = (data[0].case_id || '').match(/OA-(\d+)/);
                const lastNum = match ? parseInt(match[1]) : 0;
                const nextNum = lastNum + 1;
                return `OA-${String(nextNum).padStart(4, '0')}`;
            }
            // No submissions yet in Supabase - check local counter then start at 1
        } catch (err) {
            console.error('[CaseId] Supabase counter failed:', err.message);
        }
    }
    // Fallback to local counter file
    let counter;
    try {
        counter = JSON.parse(await fs.readFile(COUNTER_FILE, 'utf8'));
    } catch {
        counter = { lastCaseNumber: 0 };
    }
    counter.lastCaseNumber++;
    await fs.writeFile(COUNTER_FILE, JSON.stringify(counter));
    return `OA-${String(counter.lastCaseNumber).padStart(4, '0')}`;
}

// ── SMS System with 10DLC Fallback ──
// ── Communication Outcome Tracking ──
// Tracks every customer communication: send → deliver → open → reply → convert
const commsLog = []; // Last 500 entries
const commsStats = { sent: 0, delivered: 0, opened: 0, replied: 0, bounced: 0, failed: 0 };

function logComm(entry) {
    const comm = {
        id: `comm-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
        at: new Date().toISOString(),
        ...entry
    };
    commsLog.unshift(comm);
    if (commsLog.length > 500) commsLog.length = 500;
    if (entry.event === 'sent') commsStats.sent++;
    if (entry.event === 'delivered') commsStats.delivered++;
    if (entry.event === 'opened') commsStats.opened++;
    if (entry.event === 'replied') commsStats.replied++;
    if (entry.event === 'bounced') commsStats.bounced++;
    if (entry.event === 'failed') commsStats.failed++;
    return comm;
}

const smsMetrics = {
    attempts: 0,
    successes: 0,
    failures: 0,
    fallbacksToEmail: 0,
    errorCodes: {},
    lastError: null,
    lastSuccess: null,
    status: 'DEGRADED', // HEALTHY, DEGRADED, DOWN
    statusReason: '10DLC campaigns pending approval',
    log: [] // last 50 entries
};

function logSmsAttempt(to, success, errorCode, fallback, context) {
    const entry = {
        at: new Date().toISOString(),
        to: to ? to.replace(/\d(?=\d{4})/g, '*') : '?', // mask number
        success,
        errorCode: errorCode || null,
        fallback: fallback || null,
        context: context || 'unknown'
    };
    smsMetrics.log.unshift(entry);
    if (smsMetrics.log.length > 50) smsMetrics.log.pop();
    smsMetrics.attempts++;
    if (success) {
        smsMetrics.successes++;
        smsMetrics.lastSuccess = entry.at;
        // If 5 consecutive successes, upgrade status
        const recent = smsMetrics.log.slice(0, 5);
        if (recent.every(e => e.success)) {
            smsMetrics.status = 'HEALTHY';
            smsMetrics.statusReason = 'SMS delivering normally';
        }
    } else {
        smsMetrics.failures++;
        smsMetrics.lastError = { at: entry.at, code: errorCode };
        smsMetrics.errorCodes[errorCode] = (smsMetrics.errorCodes[errorCode] || 0) + 1;
        if (fallback) smsMetrics.fallbacksToEmail++;
    }
    // Update status based on success rate
    if (smsMetrics.attempts >= 5) {
        const rate = smsMetrics.successes / smsMetrics.attempts;
        if (rate < 0.5) { smsMetrics.status = 'DOWN'; smsMetrics.statusReason = `${(rate * 100).toFixed(0)}% success rate`; }
        else if (rate < 0.9) { smsMetrics.status = 'DEGRADED'; smsMetrics.statusReason = `${(rate * 100).toFixed(0)}% success rate`; }
    }
}

// Core SMS send — returns {success, sid, errorCode}
async function sendSMS(to, message, { useMessagingService = false } = {}) {
    if (!twilioClient) { console.log('SMS skipped - no Twilio client'); return { success: false, errorCode: 'NO_CLIENT' }; }
    if (!to) { console.log('SMS skipped - no recipient'); return { success: false, errorCode: 'NO_RECIPIENT' }; }
    try {
        const msgOpts = { body: message, to };
        if (useMessagingService && process.env.TWILIO_MESSAGING_SERVICE_SID) {
            msgOpts.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
        } else {
            msgOpts.from = process.env.TWILIO_SMS_NUMBER || process.env.TWILIO_PHONE_NUMBER;
        }
        const result = await twilioClient.messages.create(msgOpts);
        
        // Check delivery status after 5 seconds (Twilio may accept then fail)
        const sid = result.sid;
        setTimeout(async () => {
            try {
                const msg = await twilioClient.messages(sid).fetch();
                if (msg.status === 'undelivered' || msg.status === 'failed') {
                    const code = msg.errorCode || 'UNKNOWN';
                    console.error(`[SMS] Delayed failure: ${sid} → ${msg.status} (${code})`);
                    logSmsAttempt(to, false, code, null, 'delayed_check');
                    // If 10DLC error, update status
                    if ([30034, 30032].includes(parseInt(code))) {
                        smsMetrics.status = 'DEGRADED';
                        smsMetrics.statusReason = `10DLC block (error ${code})`;
                    }
                }
            } catch (e) { /* ignore fetch errors */ }
        }, 6000);
        
        console.log(`SMS sent to ${to} (${useMessagingService ? 'MessagingService' : 'direct'}) SID: ${sid}`);
        return { success: true, sid };
    } catch (error) {
        const code = error.code || error.message;
        console.error(`SMS failed to ${to}: ${error.message} (code: ${code})`);
        return { success: false, errorCode: code };
    }
}

// Customer-facing SMS with EMAIL FALLBACK
// If SMS fails (30034 10DLC, 30032 toll-free, or any error), auto-sends email instead
async function sendCustomerSMS(to, message, { email, customerName, context } = {}) {
    const result = await sendSMS(to, message, { useMessagingService: true });
    logSmsAttempt(to, result.success, result.errorCode, null, context || 'customer');
    logComm({ event: result.success ? 'sent' : 'failed', channel: 'sms', to, name: customerName, context, error: result.errorCode });
    
    if (!result.success) {
        const errorCode = result.errorCode;
        console.log(`[SMS→Email Fallback] SMS failed (${errorCode}) for ${to}. Attempting email fallback.`);
        
        // Try email fallback if we have an email address
        if (email) {
            try {
                const emailHtml = `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px;">
                        <p>${message.replace(/\n/g, '<br>')}</p>
                        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                        <p style="color: #999; font-size: 12px;">This message was sent via email because SMS delivery is temporarily unavailable.</p>
                    </div>`;
                await sendNotificationEmail('Message from OverAssessed', emailHtml, email);
                logSmsAttempt(to, false, errorCode, 'email_sent', context || 'customer');
                console.log(`[SMS→Email Fallback] ✅ Email sent to ${email} (SMS error: ${errorCode})`);
                
                sendTelegramAlert(`⚠️ <b>SMS FAILED → EMAIL SENT</b>\n\n<b>To:</b> ${customerName || to}\n<b>SMS Error:</b> ${errorCode}\n<b>Fallback:</b> Email sent to ${email}\n<b>Message:</b> ${message.substring(0, 100)}...`);
                
                return { success: true, method: 'email_fallback', originalError: errorCode };
            } catch (emailErr) {
                console.error(`[SMS→Email Fallback] Both failed! SMS: ${errorCode}, Email: ${emailErr.message}`);
                sendTelegramAlert(`🔴 <b>COMMUNICATION FAILURE</b>\n\n<b>To:</b> ${customerName || to}\n<b>SMS Error:</b> ${errorCode}\n<b>Email Error:</b> ${emailErr.message}\n<b>⚠️ Customer NOT reached!</b>`);
                return { success: false, method: 'both_failed', smsError: errorCode, emailError: emailErr.message };
            }
        } else {
            // No email to fall back to
            sendTelegramAlert(`⚠️ <b>SMS FAILED — NO EMAIL FALLBACK</b>\n\n<b>To:</b> ${customerName || to}\n<b>Error:</b> ${errorCode}\n<b>⚠️ No email on file — customer NOT reached!</b>`);
            return { success: false, method: 'sms_only_failed', errorCode };
        }
    }
    
    return { success: true, method: 'sms', sid: result.sid };
}

// Internal/Tyler notification SMS (direct from number, no fallback needed — Telegram is primary)
async function sendNotificationSMS(message) {
    const result = await sendSMS(process.env.NOTIFY_PHONE, message);
    logSmsAttempt(process.env.NOTIFY_PHONE, result.success, result.errorCode, null, 'tyler_notification');
}

// Telegram real-time alert
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8546685923:AAGxRV6_YwimsyLvaORNhZTNu-1JM9PtdDs';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '8568734697';

async function sendTelegramAlert(text) {
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' })
        });
        if (!resp.ok) console.error('[Telegram] Alert failed:', resp.status, await resp.text());
        else console.log('[Telegram] Alert sent');
    } catch (err) {
        console.error('[Telegram] Alert error:', err.message);
    }
}

function buildTelegramLeadAlert(sub) {
    const assessedNum = sub.assessedValue ? parseInt(String(sub.assessedValue).replace(/[^0-9]/g, '')) : 0;
    const assessed = assessedNum > 0 ? `\n💰 <b>Estimated Value:</b> $${assessedNum.toLocaleString()}` : '\n💰 <b>Estimated Value:</b> Pending analysis';
    const priority = assessedNum > 500000 ? '🔥 HIGH' : assessedNum > 300000 ? '🔥 MEDIUM' : '📋 NORMAL';
    const score = assessedNum > 500000 ? '9/10' : assessedNum > 300000 ? '7/10' : assessedNum > 0 ? '5/10' : 'Pending';
    const time = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true });

    return `🚨 NEW LEAD (OA) — ${time} CST

<b>Name:</b> ${sub.ownerName}
<b>Email:</b> ${sub.email}
<b>Phone:</b> ${sub.phone || '—'}
<b>Address:</b> ${sub.propertyAddress}
<b>County:</b> ${sub.county || '—'}
<b>Case:</b> ${sub.caseId}${assessed}
<b>Priority:</b> ${priority}
<b>Score:</b> ${score}

<b>Next Action (BOT):</b> Run comp analysis → present results
<b>Next Action (TYLER):</b> Approve outreach after analysis`;
}

// OA SMS KILL SWITCH — disabled until Twilio 10DLC fully verified
// Error 20003 = authentication failure. Email-first for all OA customer communication.
const OA_SMS_ENABLED = false;

async function sendClientSMS(phone, message, { email, customerName, context } = {}) {
    if (!OA_SMS_ENABLED) {
        console.log(`[SMS] ⚠️ OA SMS disabled (kill switch). Would have sent to ${phone}. Falling back to email.`);
        // Auto-fallback to email if available
        if (email) {
            try {
                await sendClientEmail(email, 'OverAssessed Update', `<p>${message}</p>`);
                console.log(`[SMS] ✉️ Email fallback sent to ${email}`);
                return { success: true, fallback: 'email', to: email };
            } catch (e) {
                console.error(`[SMS] Email fallback also failed:`, e.message);
            }
        }
        return { success: false, reason: 'sms_disabled', fallback: email ? 'email_attempted' : 'no_email' };
    }
    // Normalize phone to E.164
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 10) cleaned = '1' + cleaned;
    if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
    return await sendCustomerSMS(cleaned, message, { email, customerName, context });
}

async function sendNotificationEmail(subject, html, toEmail) {
    if (!process.env.SENDGRID_API_KEY) {
        console.log('Email skipped - missing config');
        return;
    }
    const to = toEmail || process.env.NOTIFY_EMAIL;
    if (!to) { console.log('Email skipped - no recipient'); return; }
    try {
        const msg = {
            to,
            from: { email: process.env.SENDGRID_FROM_EMAIL || 'notifications@overassessed.ai', name: 'OverAssessed' },
            replyTo: { email: 'tyler@reply.overassessed.ai', name: 'Tyler Worthey' },
            subject,
            html,
            trackingSettings: { clickTracking: { enable: true }, openTracking: { enable: true } }
        };
        // BCC Tyler on all outbound customer emails (skip if TO is already Tyler)
        const tylerEmail = 'tyler@overassessed.ai';
        if (to && to.toLowerCase() !== tylerEmail.toLowerCase()) {
            msg.bcc = [{ email: tylerEmail }];
        }
        await sgMail.send(msg);
        console.log(`Email sent to ${to}${msg.bcc ? ' (BCC: Tyler)' : ''}`);
        logComm({ event: 'sent', channel: 'email', to, subject });
    } catch (error) {
        console.error('Email failed:', error.message);
        logComm({ event: 'failed', channel: 'email', to, subject, error: error.message });
    }
}

// HARD RULE: ALL customer-facing emails require Tyler's approval.
// No auto-sends. No exceptions. Queue for review instead.
const OA_CLIENT_EMAIL_ENABLED = false;
const emailApprovalQueue = [];

// ========== INBOUND REPLY CLASSIFICATION ==========
// A = Sent notice/document | B = Asked question | C = Ready to proceed | D = Other
function classifyInboundReply(subject, body) {
    const text = `${subject} ${body}`.toLowerCase();
    // A: Sent notice or attachment
    if (/notice|apprais|assessment|attach|document|here.?s my|tax.?bill|photo|pdf|image|screenshot/i.test(text)) return 'A';
    // C: Ready to proceed
    if (/ready|proceed|go ahead|let.?s do it|sign me up|yes.*file|file.*protest|approve/i.test(text)) return 'C';
    // B: Question
    if (/\?|how (does|do|much|long)|what (is|are|do)|can (you|i)|when (will|do)|explain|tell me|question/i.test(text)) return 'B';
    return 'D';
}

// ========== COMMUNICATION TIER SYSTEM ==========
// Tier 1: AUTO-SEND (no approval needed)
//   - "We received your submission"
//   - "Send your notice"
//   - "We're working on your file"
// Tier 2: APPROVAL REQUIRED
//   - Any savings estimates
//   - Any analysis results
//   - Any custom replies
// Tier 3: SIGNED CLIENTS
//   - Status updates can auto-send
//   - No sales language ever
const COMM_TIER_AUTO_SEND_SUBJECTS = [
    /received your submission/i,
    /send your notice/i,
    /working on your file/i,
    /welcome to overassessed/i,
    /we.?re processing/i,
];

function getCommTier(subject, html, recipientStatus) {
    // Signed clients get status update auto-sends
    if (recipientStatus === 'signed' || recipientStatus === 'Filed') {
        if (!/savings|\$[0-9]|reduction|estimate/i.test(html)) {
            return 'auto-send-signed';
        }
    }
    // Check if subject matches auto-send patterns
    if (COMM_TIER_AUTO_SEND_SUBJECTS.some(rx => rx.test(subject))) {
        return 'auto-send';
    }
    return 'approval-required';
}

async function sendClientEmail(toEmail, subject, html, options = {}) {
    const tier = getCommTier(subject, html, options.recipientStatus);
    const isAutoSend = tier.startsWith('auto-send');
    
    if (!OA_CLIENT_EMAIL_ENABLED && !isAutoSend) {
        console.log(`[EMAIL BLOCKED] ⛔ Tier: ${tier} | Queued for approval: "${subject}" → ${toEmail}`);
        emailApprovalQueue.push({
            to: toEmail,
            subject,
            html,
            tier,
            queuedAt: new Date().toISOString(),
            status: 'pending_approval'
        });
        return { success: false, reason: 'approval_required', tier, queued: true };
    }
    
    if (isAutoSend) {
        console.log(`[EMAIL AUTO-SEND] ✅ Tier: ${tier} | "${subject}" → ${toEmail}`);
    }
    
    await sendNotificationEmail(subject, html, toEmail);
    return { success: true, tier };
}

function buildNotificationContent(sub) {
    const sms = `🏠 New OverAssessed Lead!\n\nCase: ${sub.caseId}\nName: ${sub.ownerName}\nProperty: ${sub.propertyAddress}\nType: ${sub.propertyType}\nPhone: ${sub.phone}\nEmail: ${sub.email}${sub.assessedValue ? `\nAssessed: ${sub.assessedValue}` : ''}`;

    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <div style="background: linear-gradient(135deg, #6c5ce7, #0984e3); color: white; padding: 20px; border-radius: 8px 8px 0 0;">
                <h3 style="margin: 0;">🏠 New OverAssessed Lead - ${sub.caseId}</h3>
            </div>
            <div style="background: #f7fafc; padding: 20px; border-radius: 0 0 8px 8px;">
                <table style="width: 100%; border-collapse: collapse;">
                    <tr><td style="padding: 8px 0; font-weight: bold;">Case ID:</td><td>${sub.caseId}</td></tr>
                    <tr><td style="padding: 8px 0; font-weight: bold;">Name:</td><td>${sub.ownerName}</td></tr>
                    <tr><td style="padding: 8px 0; font-weight: bold;">Email:</td><td>${sub.email}</td></tr>
                    <tr><td style="padding: 8px 0; font-weight: bold;">Phone:</td><td>${sub.phone}</td></tr>
                    <tr><td style="padding: 8px 0; font-weight: bold;">Property:</td><td>${sub.propertyAddress}</td></tr>
                    <tr><td style="padding: 8px 0; font-weight: bold;">Type:</td><td>${sub.propertyType}</td></tr>
                    ${sub.assessedValue ? `<tr><td style="padding: 8px 0; font-weight: bold;">Assessed Value:</td><td>${sub.assessedValue}</td></tr>` : ''}
                </table>
            </div>
        </div>`;

    return { sms, html };
}

function getBaseUrl() {
    return process.env.BASE_URL || 'https://overassessed.ai';
}

function brandedEmailWrapper(title, subtitle, bodyHtml) {
    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
        <div style="background-color: #6c5ce7; background: linear-gradient(135deg, #6c5ce7, #0984e3); color: #ffffff; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="margin: 0; font-size: 24px; color: #ffffff;">${title}</h1>
            ${subtitle ? `<p style="margin: 8px 0 0; color: #e8e8e8;">${subtitle}</p>` : ''}
        </div>
        <div style="background-color: #ffffff; padding: 30px; border: 1px solid #e2e8f0; border-top: none; color: #2d3436;">
            ${bodyHtml}
        </div>
        <div style="background-color: #1a1a2e; color: #ffffff; padding: 20px; border-radius: 0 0 12px 12px; text-align: center; font-size: 13px;">
            OverAssessed, LLC - San Antonio, Texas<br>
            Questions? Reply to this email or call (888) 282-9165
        </div>
    </div>`;
}

function buildWelcomeEmail(sub) {
    const portalUrl = `${getBaseUrl()}/portal`;
    const signUrl = `${getBaseUrl()}/sign/${sub.caseId}`;
    return brandedEmailWrapper('Welcome to OverAssessed', 'Your property tax protest is underway', `
            <p>Hi ${sub.ownerName},</p>
            <p>Thank you for choosing OverAssessed! Your case has been created and our team is getting started on your property tax analysis.</p>
            
            <div style="background: #f8f9ff; border: 2px solid #6c5ce7; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
                <p style="margin: 0 0 5px; font-size: 14px; color: #6b7280;">Your Case ID</p>
                <p style="margin: 0; font-size: 28px; font-weight: 800; color: #6c5ce7;">${sub.caseId}</p>
            </div>
            
            <h3 style="color: #2d3436;">What happens next:</h3>
            <ol style="color: #4a5568; line-height: 2;">
                <li>Our team analyzes your property assessment against comparable sales</li>
                <li>You'll receive your analysis report (usually within 24-48 hours)</li>
                <li>Sign the authorization form so we can file on your behalf</li>
            </ol>

            <div style="text-align: center; margin: 25px 0;">
                <a href="${signUrl}" style="background: linear-gradient(135deg, #6c5ce7, #0984e3); color: white; padding: 14px 32px; border-radius: 50px; text-decoration: none; font-weight: 700; font-size: 16px;">Sign Authorization Form →</a>
            </div>
            <p style="font-size: 13px; color: #6b7280; text-align: center;">Or <a href="${portalUrl}" style="color: #6c5ce7;">view your client portal</a> - log in with your email and case ID: <strong>${sub.caseId}</strong></p>
    `);
}

// ===== STATUS UPDATE EMAIL TEMPLATES =====
function buildStatusEmail(sub, newStatus, extras) {
    const portalUrl = `${getBaseUrl()}/portal`;
    const templates = {
        'Analysis Complete': {
            title: 'Your Analysis is Ready! 📊',
            subtitle: `Case ${sub.caseId}`,
            body: sub.needsManualReview && sub.unreliableData
                ? `<p>Hi ${sub.ownerName},</p>
                <p>We've begun our analysis for your property at <strong>${sub.propertyAddress}</strong>.</p>
                <p>To finalize your savings estimate and provide accurate numbers, we need your <strong>Notice of Appraised Value</strong> from your county appraisal district. This document contains the exact assessed value we'll be protesting.</p>
                <p>When you receive it (typically mid-April for TX), please forward it to us or upload it to your portal:</p>
                <div style="text-align:center;margin:20px 0;">
                    <a href="${getBaseUrl()}/portal" style="background:linear-gradient(135deg,#6c5ce7,#0984e3);color:white;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:700;">Upload Your Notice</a>
                </div>
                <p>Once we have your official assessed value, we'll provide a precise savings projection based on comparable properties in your area.</p>`
                : `<p>Hi ${sub.ownerName},</p>
                <p>Great news - our team has completed the analysis for your property at <strong>${sub.propertyAddress}</strong>.</p>
                ${sub.estimatedSavings ? `<div style="background:#f8f9ff;border:2px solid #00b894;border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
                    <p style="margin:0 0 5px;color:#6b7280;">Estimated Annual Tax Savings</p>
                    <p style="margin:0;font-size:32px;font-weight:800;color:#00b894;">$${sub.estimatedSavings.toLocaleString()}</p>
                </div>` : ''}
                <p>Log into your portal to view the full report and sign the authorization form:</p>
                <div style="text-align:center;margin:20px 0;">
                    <a href="${getBaseUrl()}/sign/${sub.caseId}" style="background:linear-gradient(135deg,#6c5ce7,#0984e3);color:white;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:700;">Sign Authorization & View Report</a>
                </div>`,
            sms: sub.needsManualReview && sub.unreliableData
                ? `OverAssessed: We've started analyzing your property. To get your final savings estimate, please upload your Notice of Appraised Value at ${getBaseUrl()}/portal`
                : `OverAssessed: Your analysis is ready${sub.estimatedSavings ? ` - estimated savings: $${sub.estimatedSavings.toLocaleString()}/yr` : ''}! Sign your authorization form to proceed: ${getBaseUrl()}/sign/${sub.caseId}`
        },
        'Protest Filed': {
            title: 'Your Protest Has Been Filed! 📤',
            subtitle: `Case ${sub.caseId}`,
            body: `<p>Hi ${sub.ownerName},</p>
                <p>We've officially filed your property tax protest for <strong>${sub.propertyAddress}</strong> with the appraisal district.</p>
                <p>Our team will handle everything from here. We'll notify you when your hearing is scheduled or if we reach an early settlement.</p>
                <div style="text-align:center;margin:20px 0;">
                    <a href="${portalUrl}" style="background:linear-gradient(135deg,#6c5ce7,#0984e3);color:white;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:700;">View Your Portal</a>
                </div>`,
            sms: `OverAssessed: Your property tax protest for ${sub.propertyAddress} has been filed! We'll keep you updated on progress.`
        },
        'Hearing Scheduled': {
            title: 'Your Hearing is Scheduled 🏛️',
            subtitle: `Case ${sub.caseId}`,
            body: `<p>Hi ${sub.ownerName},</p>
                <p>A hearing has been scheduled for your property tax protest on <strong>${sub.propertyAddress}</strong>.</p>
                <p>Our team will represent you - no action is needed on your part. We'll let you know the outcome as soon as the hearing concludes.</p>
                <div style="text-align:center;margin:20px 0;">
                    <a href="${portalUrl}" style="background:linear-gradient(135deg,#6c5ce7,#0984e3);color:white;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:700;">View Your Portal</a>
                </div>`,
            sms: `OverAssessed: A hearing has been scheduled for your property tax protest. Our team will represent you - no action needed!`
        },
        'Resolved': {
            title: 'Your Case is Resolved! ✅',
            subtitle: `Case ${sub.caseId}`,
            body: `<p>Hi ${sub.ownerName},</p>
                <p>Great news - your property tax protest for <strong>${sub.propertyAddress}</strong> has been resolved!</p>
                ${(extras && extras.savings) ? `<div style="background:#f8f9ff;border:2px solid #00b894;border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
                    <p style="margin:0 0 5px;color:#6b7280;">Your Annual Tax Savings</p>
                    <p style="margin:0;font-size:32px;font-weight:800;color:#00b894;">$${Number(extras.savings).toLocaleString()}</p>
                </div>` : ''}
                <p>Thank you for trusting OverAssessed. We're glad we could help reduce your property taxes.</p>
                <div style="text-align:center;margin:20px 0;">
                    <a href="${portalUrl}" style="background:linear-gradient(135deg,#6c5ce7,#0984e3);color:white;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:700;">View Final Details</a>
                </div>`,
            sms: `OverAssessed: Your property tax protest is resolved!${(extras && extras.savings) ? ` You're saving $${Number(extras.savings).toLocaleString()}/year!` : ''} View details in your portal.`
        }
    };
    return templates[newStatus] || null;
}

// ===== DRIP / FOLLOW-UP SEQUENCE =====
async function runDripCheck() {
    console.log('[Drip] Running follow-up check...');
    try {
        const submissions = await readAllSubmissions();
        const now = Date.now();
        let changed = false;

        for (let i = 0; i < submissions.length; i++) {
            const sub = submissions[i];
            // Only drip on unsigned cases that are New or Analysis Complete
            if (sub.signature) continue;
            if (!['New', 'Analysis Complete'].includes(sub.status)) continue;

            const created = new Date(sub.createdAt).getTime();
            const hoursSince = (now - created) / (1000 * 60 * 60);
            const drip = sub.dripState || {};
            const signUrl = `${getBaseUrl()}/sign/${sub.caseId}`;

            // 24hr reminder email
            if (hoursSince >= 24 && !drip.reminder24) {
                console.log(`[Drip] 24hr reminder email → ${sub.email} (${sub.caseId})`);
                sendClientEmail(sub.email, `Reminder: Sign Your Authorization - ${sub.caseId}`,
                    brandedEmailWrapper('Quick Reminder', `Case ${sub.caseId}`, `
                        <p>Hi ${sub.ownerName},</p>
                        <p>Just a friendly reminder - we still need your signed Form 50-162 to proceed with your property tax protest for <strong>${sub.propertyAddress}</strong>.</p>
                        <p>It only takes a minute:</p>
                        <div style="text-align:center;margin:25px 0;">
                            <a href="${signUrl}" style="background:linear-gradient(135deg,#6c5ce7,#0984e3);color:white;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:700;">Sign Now →</a>
                        </div>
                        <p style="font-size:13px;color:#6b7280;">This authorization allows our team to file your protest on your behalf.</p>
                    `)
                );
                drip.reminder24 = new Date().toISOString();
                changed = true;
            }

            // 48hr reminder SMS
            if (hoursSince >= 48 && !drip.reminder48) {
                console.log(`[Drip] 48hr reminder SMS → ${sub.phone} (${sub.caseId})`);
                sendClientSMS(sub.phone, `OverAssessed reminder: We still need your signed authorization to file your property tax protest. Sign here: ${signUrl}`, { email: sub.email, customerName: sub.ownerName, context: '48hr_reminder' });
                drip.reminder48 = new Date().toISOString();
                changed = true;
            }

            // 72hr final email + SMS to Tyler
            if (hoursSince >= 72 && !drip.reminder72) {
                console.log(`[Drip] 72hr final reminder → ${sub.email} + Tyler alert (${sub.caseId})`);
                sendClientEmail(sub.email, `Action Needed: Don't Miss Out - ${sub.caseId}`,
                    brandedEmailWrapper('Don\'t Miss Your Deadline', `Case ${sub.caseId}`, `
                        <p>Hi ${sub.ownerName},</p>
                        <p>We haven't received your signed authorization yet for <strong>${sub.propertyAddress}</strong>. Property tax protest deadlines are approaching and we don't want you to miss out on potential savings.</p>
                        <p>Please take a moment to sign - it only takes 60 seconds:</p>
                        <div style="text-align:center;margin:25px 0;">
                            <a href="${signUrl}" style="background:linear-gradient(135deg,#e17055,#d63031);color:white;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:700;">Sign Before It's Too Late →</a>
                        </div>
                        <p>If you have any questions or concerns, please reply to this email or call us at (888) 282-9165.</p>
                    `)
                );
                // Alert Tyler to call them
                sendNotificationSMS(`⚠️ Follow-up needed!\n${sub.ownerName} hasn't signed Form 50-162 after 72hrs.\nCase: ${sub.caseId}\nPhone: ${sub.phone}\nPlease call them.`);
                sendNotificationEmail(`⚠️ Follow-up Needed - ${sub.caseId} ${sub.ownerName}`,
                    `<div style="font-family:Arial;"><p><strong>${sub.ownerName}</strong> hasn't signed their Form 50-162 after 72 hours.</p>
                    <p>Case: ${sub.caseId}<br>Phone: <a href="tel:${sub.phone}">${sub.phone}</a><br>Email: ${sub.email}<br>Property: ${sub.propertyAddress}</p>
                    <p><strong>Please call them to follow up.</strong></p></div>`
                );
                drip.reminder72 = new Date().toISOString();
                changed = true;
            }

            submissions[i].dripState = drip;
        }

        if (changed) {
            // Write back changed submissions
            if (isSupabaseEnabled()) {
                try {
                    for (const sub of submissions) {
                        if (sub.dripState) {
                            await supabaseAdmin.from('submissions')
                                .update({ drip_state: sub.dripState, updated_at: new Date().toISOString() })
                                .eq('id', sub.id);
                        }
                    }
                } catch (err) {
                    console.error('[Drip] Supabase write failed:', err.message);
                }
            } else {
                const txSubs = submissions.filter(s => (s.state || 'TX') === 'TX');
                const gaSubs = submissions.filter(s => s.state === 'GA');
                if (txSubs.length) await writeJsonFile(TX_SUBMISSIONS_FILE, txSubs);
                if (gaSubs.length) await writeJsonFile(GA_SUBMISSIONS_FILE, gaSubs);
            }
            console.log('[Drip] Updated drip states');
        } else {
            console.log('[Drip] No actions needed');
        }
    } catch (error) {
        console.error('[Drip] Error:', error.message);
    }
}

// ── Contacted Lead Follow-Up System ──
// Day 0: Results email sent (already happened)
// Day 2: "Just checking — want me to move forward?"
// Day 5: "Last call before protest deadlines approach"
// Day 7: Mark as COLD
// If customer replies → stop all automation
async function runContactedFollowUp() {
    console.log('[FollowUp] Running contacted lead follow-up check...');
    try {
        const submissions = await readAllSubmissions();
        const now = Date.now();
        let changed = false;

        for (let i = 0; i < submissions.length; i++) {
            const sub = submissions[i];
            
            // Only process Contacted leads
            if (sub.status !== 'Contacted') continue;
            
            // Skip if customer replied (stop automation)
            if (sub.customerReplied) continue;
            
            // Skip if already cold
            if (sub.followUpStage === 'cold') continue;
            
            // Skip if no email
            if (!sub.email || sub.email.includes('benchmark@') || sub.email.includes('test@')) continue;
            
            // Calculate days since first contacted
            const contactedAt = sub.firstContactedAt || sub.stageUpdatedAt || sub.updatedAt;
            if (!contactedAt) continue;
            const daysSince = (now - new Date(contactedAt).getTime()) / (1000 * 60 * 60 * 24);
            
            const followUp = sub.contactedDrip || {};
            const savings = sub.estimatedSavings || 0;
            const savingsStr = savings > 0 ? `$${savings.toLocaleString()}/year` : 'significant';

            // Day 2: Gentle follow-up
            if (daysSince >= 2 && !followUp.day2) {
                console.log(`[FollowUp] Day 2 follow-up → ${sub.email} (${sub.caseId})`);
                const signUrl = `${getBaseUrl()}/sign/${sub.caseId}`;
                await sendClientEmail(sub.email, `Quick follow-up — ${savingsStr} in savings waiting`,
                    brandedEmailWrapper('Quick Follow-Up', `Case ${sub.caseId}`, `
                        <p>Hi ${sub.ownerName},</p>
                        <p>Just checking in — we sent your property tax analysis a couple days ago showing <strong>${savingsStr} in potential savings</strong> on <strong>${sub.propertyAddress}</strong>.</p>
                        <p>Want us to move forward with your protest? We handle everything — filing, evidence, and the hearing.</p>
                        <div style="text-align:center;margin:25px 0;">
                            <a href="${signUrl}" style="background:linear-gradient(135deg,#6c5ce7,#0984e3);color:white;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:700;">Yes, Move Forward →</a>
                        </div>
                        <p>Or simply reply YES to this email and we'll get started.</p>
                        <p style="font-size:13px;color:#6b7280;">No upfront fees. We only get paid if we save you money.</p>
                    `)
                );
                followUp.day2 = new Date().toISOString();
                changed = true;
            }

            // Day 5: Urgency follow-up
            if (daysSince >= 5 && !followUp.day5) {
                console.log(`[FollowUp] Day 5 final nudge → ${sub.email} (${sub.caseId})`);
                const signUrl = `${getBaseUrl()}/sign/${sub.caseId}`;
                await sendClientEmail(sub.email, `Last call — protest deadlines are approaching`,
                    brandedEmailWrapper('Don\'t Miss Out', `Case ${sub.caseId}`, `
                        <p>Hi ${sub.ownerName},</p>
                        <p>This is our last reminder about your property tax analysis for <strong>${sub.propertyAddress}</strong>.</p>
                        <div style="background:#fff3e0;border-left:4px solid #e67e22;padding:16px 20px;margin:20px 0;border-radius:4px;">
                            <p style="font-weight:700;color:#e67e22;margin:0;">⏰ Protest filing deadlines are approaching.</p>
                            <p style="margin:8px 0 0;color:#4a4a68;">Once the deadline passes, you'll have to wait another full year — and pay the higher tax amount in the meantime.</p>
                        </div>
                        <p>Your estimated savings: <strong>${savingsStr}</strong>. We handle the entire process at no upfront cost.</p>
                        <div style="text-align:center;margin:25px 0;">
                            <a href="${signUrl}" style="background:linear-gradient(135deg,#e17055,#d63031);color:white;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:700;">File My Protest →</a>
                        </div>
                        <p>Reply YES or click the button above. If you have questions, just reply to this email.</p>
                    `)
                );
                // Also alert Tyler
                sendTelegramAlert(`⚠️ Day 5 — Lead going cold\n\n<b>Lead:</b> ${sub.ownerName}\n<b>Savings:</b> ${savingsStr}\n<b>Property:</b> ${sub.propertyAddress}\n<b>Email:</b> ${sub.email}\n<b>Phone:</b> ${sub.phone || 'none'}\n\nFinal nudge email sent. Consider a personal call.`);
                followUp.day5 = new Date().toISOString();
                changed = true;
            }

            // Day 7: Mark as COLD
            if (daysSince >= 7 && !followUp.day7) {
                console.log(`[FollowUp] Day 7 — marking ${sub.caseId} as COLD`);
                submissions[i].followUpStage = 'cold';
                submissions[i].status = 'Cold';
                followUp.day7 = new Date().toISOString();
                
                sendTelegramAlert(`❄️ Lead marked COLD\n\n<b>Lead:</b> ${sub.ownerName}\n<b>Savings:</b> ${savingsStr}\n<b>Property:</b> ${sub.propertyAddress}\n\nNo reply after 7 days. Moved to Cold. Will re-check next protest season.`);
                changed = true;
            }

            submissions[i].contactedDrip = followUp;
        }

        if (changed) {
            // Persist to Supabase
            if (isSupabaseEnabled()) {
                try {
                    for (const sub of submissions) {
                        if (sub.contactedDrip || sub.followUpStage) {
                            const updates = { updated_at: new Date().toISOString() };
                            if (sub.contactedDrip) updates.drip_state = { ...(sub.dripState || {}), contacted: sub.contactedDrip };
                            if (sub.status === 'Cold') updates.status = 'Cold';
                            if (sub.followUpStage) updates.follow_up_note = `Stage: ${sub.followUpStage}`;
                            await supabaseAdmin.from('submissions')
                                .update(updates)
                                .eq('id', sub.id);
                        }
                    }
                    console.log('[FollowUp] Supabase updated');
                } catch (err) {
                    console.error('[FollowUp] Supabase write failed:', err.message);
                }
            }
        } else {
            console.log('[FollowUp] No follow-ups needed');
        }
    } catch (error) {
        console.error('[FollowUp] Error:', error.message);
    }
}

// ── Reply Detection: Stop automation when customer replies ──
// Called from inbound email handler and manual status updates
function markCustomerReplied(submissionId) {
    // This is called when we detect a reply from the customer
    // It sets customerReplied=true to stop all automated follow-ups
    console.log(`[FollowUp] Customer replied — stopping automation for ${submissionId}`);
}

// Auth middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);
    jwt.verify(token, process.env.JWT_SECRET || 'overassessed-secret-key-2026', (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

// ==================== SUPABASE DB ROUTES (new - /api/db/*) ====================
// These run alongside existing file-based routes. Existing routes are untouched.
if (isSupabaseEnabled()) {
    console.log('✅ Supabase enabled - mounting /api/db/* routes');
    app.use('/api/db/clients', authenticateToken, clientsRouter);
    app.use('/api/db/properties', authenticateToken, propertiesRouter);
    app.use('/api/db/appeals', authenticateToken, appealsRouter);
    app.use('/api/db/documents', authenticateToken, documentsRouter);
    app.use('/api/db/payments', authenticateToken, paymentsRouter);
    app.use('/api/db/exemptions', authenticateToken, exemptionsRouter);
    app.use('/api/db/referrals', authenticateToken, referralsRouter);
    app.use('/api/filings', authenticateToken, filingsRouter);
    app.use('/api/admin/uri-commissions', authenticateToken, uriCommissionsRouter);
    app.use('/api/pipeline', authenticateToken, pipelineRouter);
} else {
    console.log('⚠️  Supabase not configured - /api/db/* routes disabled');
}

// ==================== PUBLIC ROUTES (no auth) ====================
// These must be mounted before any auth-gated routes
if (isSupabaseEnabled()) {
    // Public exemption intake
    app.use('/api/exemptions', exemptionsRouter);
    // Public referral endpoints
    app.use('/api/referrals', referralsRouter);
    // Stripe payment routes (webhook is public, others are authenticated via admin check)
    app.use('/api/stripe', stripeRouter);
    // Coinbase Commerce Bitcoin payment routes (all public - webhook needs raw body)
    app.use('/api/coinbase', coinbaseRouter);
    app.use('/api/email', emailNurtureRouter);
    console.log('✅ Public routes mounted: /api/exemptions, /api/referrals, /api/stripe, /api/coinbase, /api/email');
}

// ==================== AGREEMENT SIGNING + FILING GATE ====================

// POST /api/agreements/sign — sign v2 agreement, create/update submission, redirect to Stripe
app.post('/api/agreements/sign', async (req, res) => {
    try {
        const { name, email, phone, address, signature, agreement_version, agreed_terms, signed_at } = req.body;
        if (!name || !email || !address) return res.status(400).json({ error: 'name, email, address required' });
        if (!signature) return res.status(400).json({ error: 'Signature required' });

        // Find or create submission
        let { data: existing } = await supabaseAdmin.from('submissions')
            .select('id, case_id').eq('email', email).is('deleted_at', null).limit(1);
        
        let submissionId;
        if (existing && existing.length > 0) {
            submissionId = existing[0].id;
            await supabaseAdmin.from('submissions').update({
                fee_agreement_signed: true,
                fee_agreement_date: signed_at || new Date().toISOString(),
                agreement_type: 'new_terms',
                agreement_version: agreement_version || 'v2',
                fee_model: '79_credit_25_percent',
                initiation_fee_required: true,
                initiation_fee_amount: 79,
                signature_data: signature,
                updated_at: new Date().toISOString()
            }).eq('id', submissionId);
        } else {
            // Parse county/state from address
            const stateMatch = address.match(/,\s*([A-Z]{2})\s*\d{5}/);
            const state = stateMatch ? stateMatch[1] : '';
            const { data: newSub } = await supabaseAdmin.from('submissions').insert({
                owner_name: name,
                email: email,
                phone: phone || null,
                property_address: address,
                state: state,
                status: 'Form Signed',
                fee_agreement_signed: true,
                fee_agreement_date: signed_at || new Date().toISOString(),
                agreement_type: 'new_terms',
                agreement_version: agreement_version || 'v2',
                fee_model: '79_credit_25_percent',
                initiation_fee_required: true,
                initiation_fee_amount: 79,
                signature_data: signature,
                source: 'web-agreement-v2'
            }).select('id, case_id').single();
            submissionId = newSub.id;
        }

        // Create Stripe checkout session
        let checkout_url = null;
        try {
            const stripeRes = await fetch(`http://localhost:${PORT}/api/stripe/initiation-checkout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer internal' },
                body: JSON.stringify({
                    submission_id: submissionId,
                    client_name: name,
                    client_email: email,
                    property_address: address
                })
            });
            const stripeData = await stripeRes.json();
            checkout_url = stripeData.checkout_url;
        } catch (e) {
            console.error('[Agreement] Stripe checkout creation failed:', e.message);
        }

        console.log(`[Agreement] v2 signed: ${name} (${email}) → ${submissionId}`);
        res.json({ success: true, submission_id: submissionId, checkout_url });
    } catch (e) {
        console.error('[Agreement] Sign error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// FILING GATE — enforced on all filing transitions
function canFile(lead) {
    if (lead.agreement_type === 'legacy_terms') return { allowed: true };
    if (!lead.fee_agreement_signed) return { allowed: false, reason: 'Agreement not signed' };
    if (!lead.initiation_paid && !lead.initiation_fee_paid) return { allowed: false, reason: 'Initiation fee not paid ($79)' };
    return { allowed: true };
}

// POST /api/admin/approve-filing — Tyler approves a lead for filing
app.post('/api/admin/approve-filing', authenticateToken, async (req, res) => {
    try {
        const { lead_id, action } = req.body; // action: 'approve' or 'reject'
        if (!lead_id || !action) return res.status(400).json({ error: 'lead_id and action required' });
        
        const { data: lead } = await supabaseAdmin.from('submissions').select('*').eq('id', lead_id).single();
        if (!lead) return res.status(404).json({ error: 'Lead not found' });
        
        if (action === 'approve') {
            await supabaseAdmin.from('submissions').update({
                status: 'Approved',
                filing_approved: true,
                filing_approved_at: new Date().toISOString(),
                filing_approved_by: req.user?.email || 'tyler',
                updated_at: new Date().toISOString()
            }).eq('id', lead_id);
            console.log(`[Approval] ✅ ${lead.case_id} ${lead.owner_name} APPROVED for filing`);
            res.json({ success: true, status: 'Approved', lead_name: lead.owner_name });
        } else if (action === 'reject') {
            const { reason } = req.body;
            await supabaseAdmin.from('submissions').update({
                status: 'Needs Revision',
                filing_approved: false,
                review_reason: reason || 'Sent back for revision',
                updated_at: new Date().toISOString()
            }).eq('id', lead_id);
            console.log(`[Approval] ❌ ${lead.case_id} ${lead.owner_name} REJECTED: ${reason}`);
            res.json({ success: true, status: 'Needs Revision', lead_name: lead.owner_name });
        } else {
            res.status(400).json({ error: 'action must be approve or reject' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/admin/pending-approvals — get all leads pending Tyler's review
app.get('/api/admin/pending-approvals', authenticateToken, async (req, res) => {
    try {
        const { data: leads } = await supabaseAdmin.from('submissions')
            .select('id,case_id,owner_name,property_address,county,state,assessed_value,estimated_savings,comp_results,qa_status,agreement_type,fee_agreement_signed,initiation_paid')
            .in('status', ['Pending Approval', 'Filing Prepared'])
            .is('deleted_at', null)
            .order('estimated_savings', { ascending: false });
        res.json(leads || []);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==================== ROUTES ====================

// ==================== OUTCOME MONITOR ROUTES ====================
// POST /api/admin/check-outcomes - manually trigger outcome check for all pending appeals
app.post('/api/admin/check-outcomes', authenticateToken, async (req, res) => {
    try {
        const result = await checkAllPendingOutcomes();
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== CONFIRM SAVINGS & AUTO-BILL ====================
// POST /api/admin/confirm-savings - confirm savings, auto-charge or send invoice
app.post('/api/admin/confirm-savings', authenticateToken, async (req, res) => {
    try {
        const { submissionId, verifiedSavings, feeRate, forceInvoice } = req.body;
        if (!submissionId || !verifiedSavings || !feeRate) {
            return res.status(400).json({ error: 'submissionId, verifiedSavings, and feeRate required' });
        }

        const fee = Math.round(verifiedSavings * feeRate * 100) / 100;

        // Get the submission
        const allSubs = await readAllSubmissions();
        const sub = allSubs.find(s => s.id === submissionId);
        if (!sub) return res.status(404).json({ error: 'Submission not found' });

        const stripeLib = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const { chargeSavedCard } = require('./routes/stripe');

        let result = null;
        let method = 'invoice';

        // Try auto-charge if client has card on file and not forcing invoice
        if (!forceInvoice && sub.stripeCustomerId) {
            // Find client_id from Supabase clients table (needed for chargeSavedCard)
            let clientId = null;
            if (isSupabaseEnabled()) {
                const { data: client } = await supabaseAdmin
                    .from('clients')
                    .select('id')
                    .eq('stripe_customer_id', sub.stripeCustomerId)
                    .single();
                if (client) clientId = client.id;

                // If no client found by stripe_customer_id, try by email
                if (!clientId) {
                    const { data: clientByEmail } = await supabaseAdmin
                        .from('clients')
                        .select('id, stripe_customer_id')
                        .eq('email', sub.email.toLowerCase())
                        .single();
                    if (clientByEmail) {
                        clientId = clientByEmail.id;
                        // Update stripe_customer_id on client if missing
                        if (!clientByEmail.stripe_customer_id) {
                            await supabaseAdmin.from('clients').update({ stripe_customer_id: sub.stripeCustomerId }).eq('id', clientId);
                        }
                    }
                }
            }

            if (clientId) {
                result = await chargeSavedCard(clientId, null, fee, `Property Tax Appeal Fee - ${sub.caseId} - ${(feeRate*100).toFixed(0)}% of $${verifiedSavings.toLocaleString()} savings`);
                if (result) method = 'auto_charge';
            }
        }

        // Fallback to invoice if no card or charge failed
        if (!result) {
            // Find or create Stripe customer
            let stripeCustomerId = sub.stripeCustomerId;
            if (!stripeCustomerId) {
                const existingCustomers = await stripeLib.customers.list({ email: sub.email.toLowerCase(), limit: 1 });
                if (existingCustomers.data.length > 0) {
                    stripeCustomerId = existingCustomers.data[0].id;
                } else {
                    const customer = await stripeLib.customers.create({
                        name: sub.ownerName,
                        email: sub.email.toLowerCase(),
                        phone: sub.phone || undefined,
                        metadata: { source: 'overassessed.ai', case_id: sub.caseId }
                    });
                    stripeCustomerId = customer.id;
                }
                // Save stripe customer to submission
                await updateSubmissionInPlace(submissionId, (subs, idx) => { subs[idx].stripeCustomerId = stripeCustomerId; });
            }

            // Create and send invoice
            const invoice = await stripeLib.invoices.create({
                customer: stripeCustomerId,
                collection_method: 'send_invoice',
                days_until_due: 30,
                metadata: { case_id: sub.caseId, source: 'overassessed.ai' }
            });
            await stripeLib.invoiceItems.create({
                customer: stripeCustomerId,
                invoice: invoice.id,
                amount: Math.round(fee * 100),
                currency: 'usd',
                description: `Property Tax Appeal Fee - ${sub.caseId} - ${(feeRate*100).toFixed(0)}% of $${verifiedSavings.toLocaleString()} savings`
            });
            const finalized = await stripeLib.invoices.finalizeInvoice(invoice.id);
            await stripeLib.invoices.sendInvoice(invoice.id);

            // Record payment in Supabase
            if (isSupabaseEnabled()) {
                await supabaseAdmin.from('payments').insert({
                    client_id: null,
                    appeal_id: null,
                    stripe_payment_id: invoice.id,
                    amount: fee,
                    status: 'invoiced'
                }).catch(e => console.log('[Billing] Payment record insert failed:', e.message));
            }

            result = { success: true, invoice_id: invoice.id, invoice_url: finalized.hosted_invoice_url, email: sub.email };
            method = 'invoice';
        }

        // Update submission status to Resolved with savings
        await updateSubmissionInPlace(submissionId, (subs, idx) => {
            subs[idx].status = 'Resolved';
            subs[idx].savings = verifiedSavings;
            subs[idx].updatedAt = new Date().toISOString();
            if (!subs[idx].notes) subs[idx].notes = [];
            subs[idx].notes.push({
                text: `💰 Savings confirmed: $${verifiedSavings.toLocaleString()} | Fee: $${fee.toFixed(2)} (${(feeRate*100).toFixed(0)}%) | Method: ${method === 'auto_charge' ? 'Auto-charged card on file' : 'Invoice sent'}`,
                author: 'Admin',
                createdAt: new Date().toISOString()
            });
        });

        // Send confirmation notification to client
        try {
            const receiptHtml = brandedEmailWrapper('Your Appeal Won!', `$${verifiedSavings.toLocaleString()} in annual savings`, `
                <h2 style="color:#00b894;">🎉 Your Property Tax Appeal Was Successful!</h2>
                <p>Great news! We successfully reduced your property taxes.</p>
                <div style="background:#f8f9ff;padding:20px;border-radius:12px;margin:20px 0;">
                    <p style="margin:0 0 8px;"><strong>Property:</strong> ${sub.propertyAddress}</p>
                    <p style="margin:0 0 8px;"><strong>Case:</strong> ${sub.caseId}</p>
                    <p style="margin:0 0 8px;"><strong>Verified Savings:</strong> <span style="color:#00b894;font-weight:700;">$${verifiedSavings.toLocaleString()}/yr</span></p>
                    <p style="margin:0 0 8px;"><strong>Our Fee (${(feeRate*100).toFixed(0)}%):</strong> $${fee.toFixed(2)}</p>
                    <p style="margin:0;"><strong>Payment:</strong> ${method === 'auto_charge' ? 'Charged to your card on file - receipt sent separately by Stripe' : 'Invoice sent to your email - due in 30 days'}</p>
                </div>
                <p>Thank you for trusting OverAssessed with your property tax appeal. We'll continue monitoring your property for future increases.</p>
            `);
            sendClientEmail(sub.email, `🎉 Your Property Tax Appeal Won - $${verifiedSavings.toLocaleString()} Saved! (${sub.caseId})`, receiptHtml);
        } catch (notifyErr) {
            console.log('[Billing] Client notification failed:', notifyErr.message);
        }

        // Notify Tyler
        sendNotificationSMS(`💰 ${sub.caseId} - Savings confirmed: $${verifiedSavings.toLocaleString()} | Fee: $${fee.toFixed(2)} | ${method === 'auto_charge' ? 'Auto-charged' : 'Invoice sent'}`);

        console.log(`[Billing] ✅ ${sub.caseId} - $${fee.toFixed(2)} ${method} for $${verifiedSavings.toLocaleString()} savings`);
        res.json({ success: true, method, fee, email: sub.email, ...result });

    } catch (err) {
        console.error('[Billing] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==================== RENTCAST ANALYSIS ROUTES ====================
// POST /api/analysis/run - full RentCast + ArcGIS analysis for any address
app.post('/api/analysis/run', authenticateToken, async (req, res) => {
    try {
        const { address } = req.body;
        if (!address) return res.status(400).json({ error: 'Address is required' });
        console.log(`[RentCast] Running analysis for: ${address}`);
        const result = await runRentCastAnalysis(address);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[RentCast] Analysis error:', error.message);
        res.status(500).json({ error: 'Analysis failed: ' + error.message });
    }
});

// GET /api/analysis/comps - comparables only
app.get('/api/analysis/comps', authenticateToken, async (req, res) => {
    try {
        const { address } = req.query;
        if (!address) return res.status(400).json({ error: 'Address query param required' });
        const comps = await getRentCastComps(address);
        res.json({ success: true, address, comparables: comps });
    } catch (error) {
        console.error('[RentCast] Comps error:', error.message);
        res.status(500).json({ error: 'Failed to fetch comps: ' + error.message });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', service: 'OverAssessed', timestamp: new Date().toISOString() });
});

// SMS Metrics & Status
app.get('/api/sms-status', (req, res) => {
    const successRate = smsMetrics.attempts > 0 
        ? ((smsMetrics.successes / smsMetrics.attempts) * 100).toFixed(1) + '%' 
        : 'N/A';
    const isBlocker = smsMetrics.attempts >= 5 && (smsMetrics.successes / smsMetrics.attempts) < 0.9;
    
    res.json({
        status: smsMetrics.status,
        statusReason: smsMetrics.statusReason,
        successRate,
        isBlocker,
        attempts: smsMetrics.attempts,
        successes: smsMetrics.successes,
        failures: smsMetrics.failures,
        fallbacksToEmail: smsMetrics.fallbacksToEmail,
        errorCodes: smsMetrics.errorCodes,
        lastError: smsMetrics.lastError,
        lastSuccess: smsMetrics.lastSuccess,
        recentLog: smsMetrics.log.slice(0, 10)
    });
});

// ── SendGrid Event Webhook — delivery/open/click/bounce tracking ──
app.post('/api/sendgrid-events', (req, res) => {
    try {
        const events = Array.isArray(req.body) ? req.body : [req.body];
        for (const evt of events) {
            const email = evt.email || '';
            const event = evt.event || '';
            const subject = evt.subject || '';
            const sgMessageId = evt.sg_message_id || '';
            
            // Map SendGrid events to our tracking
            if (event === 'delivered') {
                logComm({ event: 'delivered', channel: 'email', to: email, subject, sgMessageId });
            } else if (event === 'open') {
                logComm({ event: 'opened', channel: 'email', to: email, subject, sgMessageId });
            } else if (event === 'click') {
                logComm({ event: 'clicked', channel: 'email', to: email, subject, sgMessageId, url: evt.url });
            } else if (event === 'bounce' || event === 'dropped') {
                logComm({ event: 'bounced', channel: 'email', to: email, subject, reason: evt.reason || evt.type, sgMessageId });
                sendTelegramAlert(`📭 <b>Email ${event}</b>\n\n<b>To:</b> ${email}\n<b>Reason:</b> ${(evt.reason || evt.type || '?').substring(0, 100)}\n<b>Subject:</b> ${subject.substring(0, 60)}`);
            } else if (event === 'spam_report') {
                logComm({ event: 'spam', channel: 'email', to: email, subject, sgMessageId });
                sendTelegramAlert(`🚨 <b>SPAM REPORT</b>\n\n<b>From:</b> ${email}\n<b>Subject:</b> ${subject.substring(0, 60)}\n\n⚠️ Consider removing from outreach.`);
            }
        }
        res.status(200).send('OK');
    } catch (err) {
        console.error('[SendGridEvents] Error:', err.message);
        res.status(200).send('OK');
    }
});

// ── Communication Outcomes API ──
app.get('/api/comms-status', (req, res) => {
    const total = commsStats.sent || 1;
    
    // Calculate response rate: replied / (delivered - bounced)
    const reachable = commsStats.delivered - commsStats.bounced;
    const responseRate = reachable > 0 ? ((commsStats.replied / reachable) * 100).toFixed(1) + '%' : 'N/A';
    const openRate = commsStats.delivered > 0 ? ((commsStats.opened / commsStats.delivered) * 100).toFixed(1) + '%' : 'N/A';
    const deliveryRate = commsStats.sent > 0 ? ((commsStats.delivered / commsStats.sent) * 100).toFixed(1) + '%' : 'N/A';
    const bounceRate = commsStats.sent > 0 ? ((commsStats.bounced / commsStats.sent) * 100).toFixed(1) + '%' : 'N/A';
    
    // Check for no-reply leads that need follow-up (delivered 24h+ ago, no reply)
    const now = Date.now();
    const delivered24hAgo = commsLog.filter(c => 
        c.event === 'delivered' && 
        (now - new Date(c.at).getTime()) > 24 * 60 * 60 * 1000
    );
    const repliedEmails = new Set(commsLog.filter(c => c.event === 'replied').map(c => c.to));
    const noReply24h = delivered24hAgo.filter(c => !repliedEmails.has(c.to));
    
    res.json({
        stats: commsStats,
        rates: { deliveryRate, openRate, responseRate, bounceRate },
        noReply24h: noReply24h.length,
        noReplyLeads: noReply24h.slice(0, 10).map(c => ({ email: c.to, deliveredAt: c.at, subject: c.subject })),
        recentActivity: commsLog.slice(0, 20)
    });
});

// TAD data stats (admin)
app.get('/api/tad-stats', authenticateToken, (req, res) => {
    try {
        res.json(tarrantData.getStats() || { loaded: false, error: 'getStats returned null' });
    } catch(e) {
        res.json({ loaded: false, error: e.message });
    }
});

// TAD property lookup by account number (admin)
app.get('/api/tad-lookup/:account', authenticateToken, (req, res) => {
    try {
        const record = tarrantData.lookupAccount(req.params.account);
        if (!record) return res.status(404).json({ error: 'Account not found' });
        res.json(record);
    } catch(e) {
        res.json({ error: e.message });
    }
});

// TAD address search (admin)
app.get('/api/tad-search', authenticateToken, (req, res) => {
    const { address, limit } = req.query;
    if (!address) return res.status(400).json({ error: 'address query param required' });
    const results = tarrantData.searchByAddress(address, parseInt(limit) || 10);
    res.json({ results, count: results.length });
});

// Auth
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

        const users = await readJsonFile(USERS_FILE);
        const user = users.find(u => u.email === email);
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

        const secret = process.env.JWT_SECRET || 'overassessed-secret-key-2026';
        const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, secret, { expiresIn: '24h' });
        res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// ==================== CLIENT PORTAL AUTH ====================
/**
 * Sanitize a submission for the client portal.
 * Strips comp details, evidence packets, raw property data, and methodology -
 * clients only see the savings number and confidence, NOT the underlying data.
 */
function sanitizeForPortal(sub) {
    const safe = { ...sub };

    // Strip raw analysis data - clients don't get comp addresses, scores, or methodology
    delete safe.compResults;
    delete safe.propertyData;
    delete safe.evidencePacketPath;

    // Strip analysis report details but keep the savings summary
    if (safe.analysisReport) {
        safe.analysisReport = {
            generatedAt: safe.analysisReport.generatedAt,
            propertyAddress: safe.analysisReport.propertyAddress,
            propertyType: safe.analysisReport.propertyType,
            currentAssessedValue: safe.analysisReport.currentAssessedValue,
            estimatedTaxSavings: safe.analysisReport.estimatedTaxSavings,
            recommendation: safe.analysisReport.recommendation,
            // Replace detailed report HTML with savings-only summary
            reportHtml: buildClientSavingsHtml(sub)
        };
        // Explicitly remove comps and methodology from the sanitized report
        delete safe.analysisReport.comparables;
        delete safe.analysisReport.methodology;
        delete safe.analysisReport.estimatedMarketValue;
        delete safe.analysisReport.estimatedReduction;
        delete safe.analysisReport.taxRate;
    }

    // Strip internal fields
    delete safe.needsManualReview;
    delete safe.reviewReason;
    delete safe.pin;
    delete safe.dripState;
    delete safe.stripeCustomerId;

    return safe;
}

/**
 * Build a savings-only HTML summary for the client portal.
 * Shows the bottom line without revealing comp data or methodology.
 */
function buildClientSavingsHtml(sub) {
    const savings = sub.estimatedSavings || (sub.analysisReport && sub.analysisReport.estimatedTaxSavings) || 0;
    const assessed = (sub.analysisReport && sub.analysisReport.currentAssessedValue) || 0;
    const recommendation = (sub.analysisReport && sub.analysisReport.recommendation) || '';
    const isRecommended = savings > 0;

    return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; color: #1a1a2e;">
    <div style="background: #6c5ce7; padding: 14px 20px; border-radius: 8px 8px 0 0;">
        <span style="color: white; font-weight: 700; font-size: 15px;">OVERASSESSED</span>
        <span style="color: rgba(255,255,255,0.7); font-size: 11px; margin-left: 6px;">Property Tax Analysis</span>
    </div>
    <div style="border: 1px solid #e0e0e8; border-top: none; border-radius: 0 0 8px 8px; padding: 16px 20px;">
        <table style="width: 100%; margin-bottom: 12px; font-size: 13px;"><tr>
            <td><strong>${sub.propertyAddress}</strong></td>
            <td style="text-align: right; color: #7c7c96; font-size: 12px;">Case ${sub.caseId}</td>
        </tr></table>

        <div style="background: #00b894; color: white; border-radius: 8px; padding: 18px 20px; text-align: center; margin-bottom: 14px;">
            <div style="opacity: 0.85; font-size: 11px; margin-bottom: 4px;">ESTIMATED ANNUAL TAX SAVINGS</div>
            <div style="font-size: 32px; font-weight: 900; letter-spacing: -1px;">$${savings.toLocaleString()}</div>
            ${assessed ? `<div style="opacity: 0.7; font-size: 11px; margin-top: 4px;">Current assessed value: $${assessed.toLocaleString()}</div>` : ''}
        </div>

        <div style="background: ${isRecommended ? '#e6faf4' : '#ffeaea'}; border-left: 4px solid ${isRecommended ? '#00b894' : '#e17055'}; padding: 10px 14px; border-radius: 4px; margin-bottom: 14px;">
            <strong style="color: ${isRecommended ? '#00b894' : '#e17055'};">${isRecommended ? '✓ PROTEST RECOMMENDED' : '✗ LIMITED PROTEST POTENTIAL'}</strong>
            ${isRecommended ? '<p style="margin: 6px 0 0; font-size: 12px; color: #4a4a68;">Strong evidence supports a reduction. Sign the authorization form to proceed.</p>' : ''}
        </div>

        <div style="background: #f7f7fc; border-radius: 6px; padding: 14px 16px; margin-bottom: 10px;">
            <div style="font-weight: 700; font-size: 13px; margin-bottom: 8px;">What Happens Next</div>
            <ol style="color: #4a4a68; line-height: 1.7; font-size: 12px; margin: 0; padding-left: 18px;">
                <li><strong>Sign authorization</strong> - lets us file on your behalf</li>
                <li><strong>We build your case</strong> - comparable sales, evidence packet, filing</li>
                <li><strong>We attend your hearing</strong> - our experts represent you</li>
                <li><strong>You save money</strong> - only pay if we reduce your taxes</li>
            </ol>
        </div>

        <p style="color: #7c7c96; font-size: 10px; text-align: center; margin: 6px 0 0;">
            Prepared by OverAssessed LLC | overassessed.ai | Confidential
        </p>
    </div>
</div>`;
}

app.post('/api/portal/login', async (req, res) => {
    try {
        const { email, caseId } = req.body;
        if (!email || !caseId) return res.status(400).json({ error: 'Email and Case ID required' });

        const submissions = await readAllSubmissions();
        const sub = submissions.find(s => s.email.toLowerCase() === email.toLowerCase() && s.caseId === caseId.toUpperCase());
        if (!sub) return res.status(401).json({ error: 'No case found with that email and case ID' });

        res.json({ success: true, submission: sanitizeForPortal(sub) });
    } catch (error) {
        console.error('Portal login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// GET portal data by case ID + email (simple auth via query params)
app.get('/api/portal/case', async (req, res) => {
    try {
        const { email, caseId } = req.query;
        if (!email || !caseId) return res.status(400).json({ error: 'Missing email or caseId' });

        const submissions = await readAllSubmissions();
        const sub = submissions.find(s => s.email.toLowerCase() === email.toLowerCase() && s.caseId === caseId.toUpperCase());
        if (!sub) return res.status(404).json({ error: 'Case not found' });

        // Return sanitized data - no comp details, evidence, or methodology
        res.json(sanitizeForPortal(sub));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch case' });
    }
});

// ==================== PRE-REGISTRATION ====================
app.post('/api/pre-register', async (req, res) => {
    try {
        const { name, email, phone, property_address, county } = req.body;
        if (!name || !email || !property_address || !county) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        if (!isSupabaseEnabled()) {
            return res.status(503).json({ error: 'Database not configured' });
        }
        const insertData = { name, email, property_address, county };
        if (phone) insertData.phone = phone;
        const { data, error } = await supabaseAdmin.from('pre_registrations').insert(insertData).select().single();
        if (error) throw error;

        // Send confirmation email
        if (process.env.SENDGRID_API_KEY) {
            try {
                await sgMail.send({
                    to: email,
                    bcc: [{ email: 'tyler@overassessed.ai' }],
                    from: { email: process.env.SENDGRID_FROM_EMAIL || 'notifications@overassessed.ai', name: 'OverAssessed' },
                    replyTo: { email: 'tyler@reply.overassessed.ai', name: 'Tyler Worthey' },
                    subject: '✅ You\'re Pre-Registered for TX Property Tax Season!',
                    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
                        <h2 style="color:#6c5ce7;">You're on the list, ${name}!</h2>
                        <p>We'll analyze <strong>${property_address}</strong> in <strong>${county} County</strong> the moment appraisal notices drop in April.</p>
                        <p>You'll get a head start on your protest - no action needed until then.</p>
                        <p style="color:#636e72;font-size:14px;">- The OverAssessed Team</p>
                    </div>`
                });
            } catch (e) { console.error('Pre-reg confirmation email failed:', e.message); }
        }
        // Notify admin
        try { await sendNotificationSMS(`New pre-registration: ${name} (${email}) - ${property_address}, ${county} County`); } catch(e) {}
        try { await sendNotificationEmail('New Pre-Registration', `<p><strong>${name}</strong> (${email})<br>${property_address}<br>${county} County</p>`); } catch(e) {}
        try { await sendTelegramAlert(`📋 NEW PRE-REGISTRATION\n\n<b>Name:</b> ${name}\n<b>Email:</b> ${email}\n<b>Property:</b> ${property_address}\n<b>County:</b> ${county || '—'}\n\n➡️ Will convert to full lead when protest season opens.`); } catch(e) {}

        res.json({ success: true, id: data.id });
    } catch (error) {
        console.error('Pre-registration error:', error);
        res.status(500).json({ error: 'Failed to save pre-registration' });
    }
});

// ==================== SIMPLE LANDING PAGE LEAD ====================
app.post('/api/simple-lead', async (req, res) => {
    try {
        const { property_address, email, source, state_hint, assessed_value, property_type, county: submitted_county, phone, owner_name } = req.body;
        if (!property_address || !email) {
            return res.status(400).json({ error: 'Address and email are required' });
        }
        // Track missing required fields
        const missingFields = [];
        if (!assessed_value) missingFields.push('assessed_value');
        if (!submitted_county && !property_address.match(/county/i)) missingFields.push('county');
        if (!property_type) missingFields.push('property_type');
        if (!isSupabaseEnabled()) {
            return res.status(503).json({ error: 'Database not configured' });
        }

        // Auto-detect state and county from address
        let state = null, county = null;
        const stateMatch = property_address.match(/,\s*([A-Z]{2})\s*\d{0,5}\s*$/i) || property_address.match(/,\s*(\w+)\s*$/);
        if (stateMatch) {
            const s = stateMatch[1].trim().toUpperCase();
            const stateMap = { TX: 'TX', TEXAS: 'TX', AZ: 'AZ', ARIZONA: 'AZ', CO: 'CO', COLORADO: 'CO', GA: 'GA', GEORGIA: 'GA', WA: 'WA', WASHINGTON: 'WA', OH: 'OH', OHIO: 'OH' };
            state = stateMap[s] || s;
        }
        // Fallback: use state_hint from frontend (from URL ?state= param)
        if (!state && state_hint) {
            const hintMap = { TX: 'TX', GA: 'GA', WA: 'WA', AZ: 'AZ', CO: 'CO', OH: 'OH' };
            state = hintMap[state_hint.toUpperCase()] || null;
        }
        // Common TX county detection
        const addrLower = property_address.toLowerCase();
        if (addrLower.includes('san antonio') || addrLower.includes('78')) county = 'Bexar';
        else if (addrLower.includes('houston')) county = 'Harris';
        else if (addrLower.includes('dallas')) county = 'Dallas';
        else if (addrLower.includes('austin')) county = 'Travis';
        else if (addrLower.includes('fort worth')) county = 'Tarrant';

        // === DEDUPE CHECK ===
        const normalizedEmail = email.trim().toLowerCase();
        const normalizedAddress = property_address.trim().replace(/\s+/g, ' ').replace(/,\s*/g, ', ');
        
        // Check for existing submission with same email in last 24 hours
        const { data: existingByEmail } = await supabaseAdmin
            .from('submissions')
            .select('case_id, property_address, email, created_at, status')
            .eq('email', normalizedEmail)
            .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .neq('status', 'Duplicate')
            .limit(1);
        
        if (existingByEmail && existingByEmail.length > 0) {
            const existing = existingByEmail[0];
            console.log(`[SIMPLE LEAD] ⚠️ DEDUPE: ${normalizedEmail} already submitted as ${existing.case_id} (${existing.property_address})`);
            // Update existing case with better address if this one has more detail
            if (normalizedAddress.length > (existing.property_address || '').length) {
                await supabaseAdmin
                    .from('submissions')
                    .update({ property_address: normalizedAddress, county: county || undefined, state: state || undefined })
                    .eq('case_id', existing.case_id);
                console.log(`[SIMPLE LEAD] Updated ${existing.case_id} with better address: ${normalizedAddress}`);
            }
            return res.json({ success: true, caseId: existing.case_id, message: 'Existing case found', deduplicated: true });
        }

        const insertData = {
            property_address: normalizedAddress,
            email: normalizedEmail,
            source: source || 'simple-form',
            state,
            county,
            created_at: new Date().toISOString()
        };

        const { data, error } = await supabaseAdmin.from('simple_leads').insert(insertData).select().single();
        if (error) {
            // If table doesn't exist, fall back to submissions table
            if (error.message.includes('relation') || error.message.includes('schema cache') || error.message.includes('simple_leads') || error.code === '42P01') {
                const caseId = await getNextCaseId();
                const fallback = {
                    id: require('uuid').v4(),
                    case_id: caseId,
                    owner_name: owner_name || 'Simple Form Lead',
                    email: email.trim().toLowerCase(),
                    phone: phone || null,
                    property_address,
                    property_type: property_type || 'residential',
                    county: submitted_county || county || null,
                    state: state || null,
                    source: 'simple-form',
                    status: missingFields.length > 0 ? 'New' : 'New',
                    assessed_value: assessed_value ? Number(assessed_value) : null,
                    assigned_to: 'Tyler',
                    lead_priority: 'normal',
                    verification_status: 'needs-data',
                    fee_rate: 0.25,
                    pricing_seen: 0.25,
                    pricing_source: 'simple-form-post-fix',
                    pricing_locked: true,
                    notes: missingFields.length > 0 ? `Missing at intake: ${missingFields.join(', ')}` : null
                };
                const { data: fbData, error: fbError } = await supabaseAdmin.from('submissions').insert(fallback).select().single();
                if (fbError) throw fbError;
                
                // === AUTO-RESPONSE SYSTEM ===
                const leadId = fbData.id;
                const caseNum = caseId;
                
                // 1. Auto-assign (default: Tyler for OA leads)
                const assignee = 'Tyler';
                const assigneeEmail = 'tyler@overassessed.ai';
                
                // 2. Send instant acknowledgment email to lead
                try {
                    await sgMail.send({
                        to: email.trim().toLowerCase(),
                        from: { email: 'tyler@overassessed.ai', name: 'OverAssessed Team' },
                        replyTo: { email: 'tyler@overassessed.ai', name: 'Tyler Worthey' },
                        subject: 'Your Property Tax Savings — Next Step',
                        html: `<p>Hi there,</p><p>Thanks for submitting your property for review.</p><p>We're currently analyzing your property to identify potential tax savings. One of our specialists will review your case and follow up with you shortly.</p><p>If you'd like to speed things up, feel free to reply to this email with any additional details or questions.</p><p>Best,<br>OverAssessed Team</p>`
                    });
                    console.log(`[SIMPLE LEAD] ✅ Auto-email sent to ${email}`);
                } catch (emailErr) {
                    console.error(`[SIMPLE LEAD] ❌ Auto-email failed for ${email}:`, emailErr.message);
                }
                
                // 3. Notify Tyler (assignee)
                try {
                    await sgMail.send({
                        to: 'tyler@overassessed.ai',
                        from: { email: 'notifications@overassessed.ai', name: 'OverAssessed CRM' },
                        subject: `🎯 New Lead: ${caseNum} — ${state || 'Unknown'} | ${property_address.substring(0, 40)}`,
                        html: `<h3>New /simple Lead</h3><p><b>Case:</b> ${caseNum}</p><p><b>Email:</b> ${email}</p><p><b>Property:</b> ${property_address}</p><p><b>State:</b> ${state || '—'}</p><p><b>County:</b> ${county || '—'}</p><p><b>Assigned to:</b> ${assignee}</p><p>Auto-acknowledgment email sent to lead ✅</p>`
                    });
                    console.log(`[SIMPLE LEAD] ✅ Notification sent to Tyler`);
                } catch (notifyErr) {
                    console.error(`[SIMPLE LEAD] ❌ Notification failed:`, notifyErr.message);
                }
                
                // 4. Telegram alert
                sendTelegramAlert(`🎯 SIMPLE FORM LEAD\n\n<b>Case:</b> ${caseNum}\n<b>Email:</b> ${email}\n<b>Property:</b> ${property_address}\n<b>State:</b> ${state || '—'}\n<b>County:</b> ${county || '—'}\n<b>Assigned:</b> ${assignee}\n\n✅ Auto-email sent to lead\n✅ Notification sent to ${assignee}`);
                
                // 5. Update status to Contacted
                try {
                    await supabaseAdmin.from('submissions').update({
                        status: 'Contacted',
                        drip_state: { status: 'contacted', firstContactedAt: new Date().toISOString(), channel: 'email', assignee },
                        updated_at: new Date().toISOString()
                    }).eq('id', leadId);
                } catch (updateErr) {
                    console.error(`[SIMPLE LEAD] Status update failed:`, updateErr.message);
                }
                
                // 6. AUTO-ANALYSIS PIPELINE (async, don't block response)
                setTimeout(async () => {
                    try {
                        console.log(`[SimpleAnalysis] Starting analysis for ${caseNum}: ${property_address}`);
                        
                        // Build case data for property lookup
                        const caseData = {
                            propertyAddress: property_address,
                            state: state || 'TX',
                            county: county || null,
                            id: leadId
                        };
                        
                        // Step 1: Fetch property data
                        let propertyData;
                        try {
                            propertyData = await fetchPropertyData(caseData);
                        } catch (fetchErr) {
                            console.error(`[SimpleAnalysis] Property lookup failed for ${caseNum}:`, fetchErr.message);
                            propertyData = null;
                        }
                        
                        const assessedValue = propertyData?.assessedValue || 0;
                        const hasRealData = assessedValue > 0 && propertyData?.source !== 'intake-fallback';
                        
                        if (hasRealData) {
                            // Step 2: Find comps
                            const MIN_COMPS_REQUIRED = 5;
                            let compResults;
                            let compSearchLog = { methods: [], totalAttempts: 0 };
                            
                            try {
                                compResults = await findComparables(propertyData, caseData);
                                compSearchLog.methods.push('standard');
                                compSearchLog.totalAttempts++;
                            } catch (compErr) {
                                console.error(`[SimpleAnalysis] Comps failed for ${caseNum}:`, compErr.message);
                                compResults = null;
                            }
                            
                            const compsFound = compResults?.comps?.length || 0;
                            const compAddresses = (compResults?.comps || []).map(c => c.address).filter(Boolean);
                            console.log(`[SimpleAnalysis] ${caseNum}: ${compsFound} comps found via standard search`);
                            console.log(`[SimpleAnalysis] ${caseNum}: Comp addresses: ${compAddresses.join(', ') || 'none'}`);
                            
                            // === 5-COMP MINIMUM RULE ===
                            if (compsFound >= MIN_COMPS_REQUIRED) {
                                // PATH A: Full analysis — 5+ comps found
                                const estimatedSavings = compResults?.estimatedSavings || Math.round(assessedValue * 0.08 * 0.023);
                                const reduction = compResults?.reduction || Math.round(assessedValue * 0.08);
                                const recommendedValue = compResults?.recommendedValue || (assessedValue - reduction);
                                
                                await supabaseAdmin.from('submissions').update({
                                    status: 'Analyzed',
                                    drip_state: {
                                        status: 'analyzed',
                                        firstContactedAt: new Date().toISOString(),
                                        channel: 'email',
                                        assignee: 'Tyler',
                                        analysisComplete: true,
                                        assessedValue,
                                        recommendedValue,
                                        estimatedSavings,
                                        compsFound,
                                        compAddresses: compAddresses.slice(0, 10),
                                        searchLog: compSearchLog,
                                        primaryStrategy: compResults?.primaryStrategy || 'market_value'
                                    },
                                    updated_at: new Date().toISOString()
                                }).eq('id', leadId);
                                
                                const savingsFormatted = estimatedSavings.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
                                const assessedFormatted = assessedValue.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
                                const recommendedFormatted = recommendedValue.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });
                                
                                await sgMail.send({
                                    to: email.trim().toLowerCase(),
                                    from: { email: 'tyler@overassessed.ai', name: 'OverAssessed' },
                                    replyTo: { email: 'tyler@overassessed.ai', name: 'Tyler Worthey' },
                                    subject: `You may be overassessed by ${savingsFormatted}/year — ${caseNum}`,
                                    html: `<h2>Your Property Tax Analysis</h2>
                                        <p>We've completed a preliminary analysis of your property at <b>${property_address}</b>.</p>
                                        <table style="border-collapse:collapse;margin:16px 0;">
                                            <tr><td style="padding:8px 16px;border:1px solid #ddd;">Current Assessed Value</td><td style="padding:8px 16px;border:1px solid #ddd;font-weight:bold;">${assessedFormatted}</td></tr>
                                            <tr><td style="padding:8px 16px;border:1px solid #ddd;">Our Recommended Value</td><td style="padding:8px 16px;border:1px solid #ddd;font-weight:bold;color:#16a34a;">${recommendedFormatted}</td></tr>
                                            <tr><td style="padding:8px 16px;border:1px solid #ddd;">Estimated Annual Savings</td><td style="padding:8px 16px;border:1px solid #ddd;font-weight:bold;color:#16a34a;font-size:1.2em;">${savingsFormatted}</td></tr>
                                        </table>
                                        <p>Based on ${compsFound} comparable properties in your area, your property appears to be <b>over-assessed</b>.</p>
                                        <p><b>Next step:</b> Reply to this email or call us to start your protest. We handle everything — no win, no fee.</p>
                                        <p>Best,<br>Tyler Worthey<br>OverAssessed Team</p>`
                                });
                                console.log(`[SimpleAnalysis] ✅ PATH A (${compsFound} comps) — Analysis email sent to ${email} | Savings: ${savingsFormatted}`);
                                
                                sendTelegramAlert(`📊 <b>ANALYSIS COMPLETE (${compsFound} comps)</b>\n\n<b>Case:</b> ${caseNum}\n<b>Property:</b> ${property_address}\n<b>Assessed:</b> ${assessedFormatted}\n<b>Recommended:</b> ${recommendedFormatted}\n<b>Savings:</b> ${savingsFormatted}\n<b>Comps:</b> ${compsFound}\n<b>Strategy:</b> ${compResults?.primaryStrategy || 'market_value'}\n\n✅ Analysis email sent to lead`);
                                
                            } else if (compsFound >= 1) {
                                // PARTIAL: 1-4 comps — NOT complete, needs fallback
                                console.log(`[SimpleAnalysis] ${caseNum}: PARTIAL — only ${compsFound} comps. Minimum is ${MIN_COMPS_REQUIRED}.`);
                                
                                await supabaseAdmin.from('submissions').update({
                                    status: 'Partial Analysis',
                                    drip_state: {
                                        status: 'partial-analysis',
                                        firstContactedAt: new Date().toISOString(),
                                        channel: 'email',
                                        assignee: 'Tyler',
                                        analysisComplete: false,
                                        assessedValue,
                                        compsFound,
                                        compAddresses: compAddresses.slice(0, 10),
                                        searchLog: compSearchLog,
                                        needsMoreComps: true,
                                        reason: `Only ${compsFound} comp(s) found — minimum 5 required for complete analysis`
                                    },
                                    updated_at: new Date().toISOString()
                                }).eq('id', leadId);
                                
                                // Send needs-docs email (we found the property but can't complete analysis)
                                await sgMail.send({
                                    to: email.trim().toLowerCase(),
                                    from: { email: 'tyler@overassessed.ai', name: 'OverAssessed' },
                                    replyTo: { email: 'tyler@overassessed.ai', name: 'Tyler Worthey' },
                                    subject: `We're working on your analysis — ${caseNum}`,
                                    html: `<h2>Your Analysis Is In Progress</h2>
                                        <p>We found your property at <b>${property_address}</b> with an assessed value of <b>${assessedValue.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })}</b>.</p>
                                        <p>We're still gathering comparable properties to ensure our analysis meets our quality standards. To speed things up, you can:</p>
                                        <ol>
                                            <li>Reply with your <b>Notice of Appraised Value</b> (photo or scan)</li>
                                            <li>Share any recent appraisals or sales data for nearby homes</li>
                                        </ol>
                                        <p>We'll have your complete analysis within 24–48 hours.</p>
                                        <p>Best,<br>Tyler Worthey<br>OverAssessed Team</p>`
                                });
                                console.log(`[SimpleAnalysis] ⚠️ PARTIAL (${compsFound}/${MIN_COMPS_REQUIRED} comps) — Partial email sent to ${email}`);
                                
                                sendTelegramAlert(`⚠️ <b>PARTIAL ANALYSIS (${compsFound}/${MIN_COMPS_REQUIRED} comps)</b>\n\n<b>Case:</b> ${caseNum}\n<b>Property:</b> ${property_address}\n<b>Assessed:</b> ${assessedValue.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })}\n<b>Comps Found:</b> ${compsFound} (need ${MIN_COMPS_REQUIRED})\n<b>Comp Addresses:</b> ${compAddresses.join(', ') || 'none'}\n\n🔍 Needs fallback comp search or manual review`);
                                
                            } else {
                                // ZERO COMPS with real data — mark for manual review
                                console.log(`[SimpleAnalysis] ${caseNum}: 0 comps found despite real data. Manual review needed.`);
                                
                                await supabaseAdmin.from('submissions').update({
                                    status: 'Needs Data',
                                    drip_state: {
                                        status: 'needs-docs',
                                        firstContactedAt: new Date().toISOString(),
                                        channel: 'email',
                                        assignee: 'Tyler',
                                        needsNotice: true,
                                        assessedValue,
                                        compsFound: 0,
                                        searchLog: compSearchLog,
                                        reason: 'Property found but zero comparable properties matched'
                                    },
                                    updated_at: new Date().toISOString()
                                }).eq('id', leadId);
                                
                                await sgMail.send({
                                    to: email.trim().toLowerCase(),
                                    from: { email: 'tyler@overassessed.ai', name: 'OverAssessed' },
                                    replyTo: { email: 'tyler@overassessed.ai', name: 'Tyler Worthey' },
                                    subject: `Action Needed: Upload Your Notice of Appraised Value — ${caseNum}`,
                                    html: `<h2>We Need One More Thing</h2>
                                        <p>Thanks for submitting your property at <b>${property_address}</b>.</p>
                                        <p>To complete your analysis and calculate your exact savings, we need your <b>Notice of Appraised Value</b> from your county appraisal district.</p>
                                        <p><b>What to do:</b></p>
                                        <ol>
                                            <li>Check your mail for the notice (usually arrives April–May)</li>
                                            <li>Take a photo or scan it</li>
                                            <li>Reply to this email with the image attached</li>
                                        </ol>
                                        <p>Once we have your notice, we'll complete your analysis within 24 hours and let you know exactly how much you can save.</p>
                                        <p>Best,<br>Tyler Worthey<br>OverAssessed Team</p>`
                                });
                                console.log(`[SimpleAnalysis] ✅ PATH B (0 comps) — Needs-docs email sent to ${email}`);
                                
                                sendTelegramAlert(`📦 <b>NEEDS NOTICE (0 comps)</b>\n\n<b>Case:</b> ${caseNum}\n<b>Property:</b> ${property_address}\n<b>Assessed:</b> ${assessedValue.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })}\n<b>State:</b> ${state || '—'}\n\nProperty found but no comps matched.\n✅ Needs-docs email sent to lead`);
                            }
                            
                        } else {
                            // No real assessed value — needs notice
                            await supabaseAdmin.from('submissions').update({
                                status: 'Needs Data',
                                drip_state: {
                                    status: 'needs-docs',
                                    firstContactedAt: new Date().toISOString(),
                                    channel: 'email',
                                    assignee: 'Tyler',
                                    needsNotice: true,
                                    compsFound: 0,
                                    reason: 'No real assessed value found — property lookup failed'
                                },
                                updated_at: new Date().toISOString()
                            }).eq('id', leadId);
                            
                            // Send needs-docs email
                            await sgMail.send({
                                to: email.trim().toLowerCase(),
                                from: { email: 'tyler@overassessed.ai', name: 'OverAssessed' },
                                replyTo: { email: 'tyler@overassessed.ai', name: 'Tyler Worthey' },
                                subject: `Action Needed: Upload Your Notice of Appraised Value — ${caseNum}`,
                                html: `<h2>We Need One More Thing</h2>
                                    <p>Thanks for submitting your property at <b>${property_address}</b>.</p>
                                    <p>To complete your analysis and calculate your exact savings, we need your <b>Notice of Appraised Value</b> from your county appraisal district.</p>
                                    <p><b>What to do:</b></p>
                                    <ol>
                                        <li>Check your mail for the notice (usually arrives April–May)</li>
                                        <li>Take a photo or scan it</li>
                                        <li>Reply to this email with the image attached</li>
                                    </ol>
                                    <p>Once we have your notice, we'll complete your analysis within 24 hours and let you know exactly how much you can save.</p>
                                    <p>Best,<br>Tyler Worthey<br>OverAssessed Team</p>`
                            });
                            console.log(`[SimpleAnalysis] ✅ PATH B (no data) — Needs-docs email sent to ${email}`);
                            
                            sendTelegramAlert(`📦 <b>NEEDS NOTICE</b>\n\n<b>Case:</b> ${caseNum}\n<b>Property:</b> ${property_address}\n<b>State:</b> ${state || '—'}\n\nProperty lookup returned no assessed value.\n✅ Needs-docs email sent to lead\n🏷 Tagged: needs-docs`);
                        }
                    } catch (analysisErr) {
                        console.error(`[SimpleAnalysis] Pipeline failed for ${caseNum}:`, analysisErr.message);
                        sendTelegramAlert(`\u274c <b>ANALYSIS FAILED</b>\n\n<b>Case:</b> ${caseNum}\n<b>Error:</b> ${analysisErr.message}\n\nLead has ack email but no analysis. Needs manual review.`);
                    }
                }, 3000); // Start 3s after response to avoid blocking
                
                return res.json({ success: true, id: leadId, state, county });
            }
            throw error;
        }

        // === AUTO-RESPONSE (simple_leads table path) ===
        try {
            await sgMail.send({
                to: email.trim().toLowerCase(),
                from: { email: 'tyler@overassessed.ai', name: 'OverAssessed Team' },
                replyTo: { email: 'tyler@overassessed.ai', name: 'Tyler Worthey' },
                subject: 'Your Property Tax Savings — Next Step',
                html: `<p>Hi there,</p><p>Thanks for submitting your property for review.</p><p>We're currently analyzing your property to identify potential tax savings. One of our specialists will review your case and follow up with you shortly.</p><p>If you'd like to speed things up, feel free to reply to this email with any additional details or questions.</p><p>Best,<br>OverAssessed Team</p>`
            });
            console.log(`[SIMPLE LEAD] ✅ Auto-email sent to ${email}`);
        } catch (emailErr) {
            console.error(`[SIMPLE LEAD] ❌ Auto-email failed:`, emailErr.message);
        }
        
        sendTelegramAlert(`🎯 SIMPLE FORM LEAD\n\n<b>Email:</b> ${email}\n<b>Property:</b> ${property_address}\n<b>State:</b> ${state || '—'}\n<b>County:</b> ${county || '—'}\n\n✅ Auto-email sent to lead\n✅ Assigned to Tyler`);

        res.json({ success: true, id: data.id, state, county });
    } catch (error) {
        console.error('Simple lead error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/simple-lead/:id/details', async (req, res) => {
    try {
        const { id } = req.params;
        const { bedrooms, bathrooms, sqft, yearBuilt, ownerName, phone } = req.body;
        if (!isSupabaseEnabled()) return res.status(503).json({ error: 'Database not configured' });

        // Try simple_leads first, then calculator_leads
        const updateData = {};
        if (bedrooms) updateData.bedrooms = parseInt(bedrooms);
        if (bathrooms) updateData.bathrooms = parseFloat(bathrooms);
        if (sqft) updateData.sqft = parseInt(sqft);
        if (yearBuilt) updateData.year_built = parseInt(yearBuilt);
        if (ownerName) updateData.name = ownerName;
        if (phone) updateData.phone = phone;

        // Update submissions table (snake_case columns)
        const subUpdate = {};
        if (ownerName) subUpdate.owner_name = ownerName;
        if (phone) subUpdate.phone = phone;
        if (bedrooms) subUpdate.bedrooms = parseInt(bedrooms);
        if (bathrooms) subUpdate.bathrooms = parseFloat(bathrooms);
        if (sqft) subUpdate.sqft = parseInt(sqft);
        if (yearBuilt) subUpdate.year_built = parseInt(yearBuilt);
        
        const { error } = await supabaseAdmin.from('submissions').update(subUpdate).eq('id', id);
        if (error) {
            console.error('Simple lead detail update error:', error);
            return res.json({ success: true, note: 'details logged' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Simple lead detail error:', error);
        res.json({ success: true, note: 'details logged' });
    }
});

// Serve simple landing page
app.get('/simple', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'simple.html'));
});

app.post('/api/calculator-lead', async (req, res) => {
    try {
        const { name, email, phone, property_address, county, assessed_value, estimated_savings, property_type } = req.body;
        if (!name || !email || !property_address || !county || !assessed_value) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        if (!isSupabaseEnabled()) {
            return res.status(503).json({ error: 'Database not configured' });
        }
        const insertData = { 
            name, email, property_address, county, 
            assessed_value: parseInt(assessed_value),
            estimated_savings: parseInt(estimated_savings || 0),
            property_type: property_type || 'residential',
            source: 'calculator'
        };
        if (phone) insertData.phone = phone;
        const { data, error } = await supabaseAdmin.from('calculator_leads').insert(insertData).select().single();
        if (error) throw error;
        sendTelegramAlert(`📊 CALCULATOR LEAD\n\n<b>Name:</b> ${name}\n<b>Email:</b> ${email}\n<b>Phone:</b> ${phone || '—'}\n<b>Property:</b> ${property_address}\n<b>County:</b> ${county}\n<b>Assessed:</b> $${parseInt(assessed_value).toLocaleString()}\n<b>Est. Savings:</b> $${parseInt(estimated_savings || 0).toLocaleString()}\n\n➡️ Hot lead — used savings calculator.`);
        res.json({ success: true, data });
    } catch (error) {
        console.error('Calculator lead error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/pre-registrations/count', async (req, res) => {
    try {
        if (!isSupabaseEnabled()) return res.json({ count: 0 });
        const { count, error } = await supabaseAdmin.from('pre_registrations')
            .select('*', { count: 'exact', head: true });
        if (error) throw error;
        res.json({ count: count || 0 });
    } catch (error) {
        res.json({ count: 0 });
    }
});

app.get('/api/pre-registrations', authenticateToken, async (req, res) => {
    try {
        if (!isSupabaseEnabled()) return res.json([]);
        const { data, error } = await supabaseAdmin.from('pre_registrations')
            .select('*').order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch pre-registrations' });
    }
});

// ==================== DUPLICATE CHECK (lightweight) ====================
app.get('/api/intake/check-duplicate', async (req, res) => {
    try {
        if (!isSupabaseEnabled()) return res.json({ duplicate: false });
        const { email, address } = req.query;
        if (!email && !address) return res.json({ duplicate: false });

        // The imported normalizeAddress function handles normalization.

        let matches = [];
        if (email) {
            const { data } = await supabaseAdmin
                .from('submissions')
                .select('case_id, property_address, email')
                .ilike('email', email.trim().toLowerCase());
            if (data) matches = data;
        }

        if (matches.length > 0 && address) {
            const addrMatch = matches.find(m => addressesMatch(address, m.property_address));
            if (addrMatch) {
                return res.json({ duplicate: true, caseId: addrMatch.case_id, message: "It looks like you've already submitted this property. Check your email for updates!" });
            }
        } else if (matches.length > 0) {
            return res.json({ duplicate: true, caseId: matches[0].case_id, message: "We already have a submission with this email. Check your email for updates!" });
        }

        // Check address alone if no email match
        if (address && matches.length === 0) {
            const normAddr = normalizeAddress(address);
            if (normAddr.length > 10) {
                const { data } = await supabaseAdmin.from('submissions').select('case_id, property_address, email');
                if (data) {
                    const addrMatch = data.find(m => addressesMatch(address, m.property_address));
                    if (addrMatch) {
                        return res.json({ duplicate: true, caseId: addrMatch.case_id, message: "It looks like this property has already been submitted. Check your email for updates!" });
                    }
                }
            }
        }

        return res.json({ duplicate: false });
    } catch (err) {
        console.error('[DupCheck] Error:', err.message);
        return res.json({ duplicate: false });
    }
});

// ==================== INTAKE (enhanced) ====================
app.post('/api/intake', upload.single('noticeFile'), async (req, res) => {
    try {
        const { propertyAddress, propertyType, ownerName, phone, email, assessedValue, source, utm_data, county, notificationPref, ref,
                bedrooms, bathrooms, sqft, yearBuilt, renovations, renovationDesc, conditionIssues, conditionDesc, recentAppraisal, appraisedValue, appraisalDate,
                stripeCustomerId, stripePaymentMethodId } = req.body;
        if (!propertyAddress || !propertyType || !ownerName || !phone || !email) {
            return res.status(400).json({ error: 'Missing required fields: propertyAddress, propertyType, ownerName, phone, email' });
        }
        // SECTION 7: assessed_value and county now required
        if (!assessedValue) {
            return res.status(400).json({ error: 'Assessed value is required. Check your county appraisal district notice.', field: 'assessedValue' });
        }
        if (!county) {
            return res.status(400).json({ error: 'County is required to process your protest.', field: 'county' });
        }

        // === Input validation & auto-correction ===
        const validation = validateIntakeFields(req.body);
        if (!validation.valid) {
            console.log(`[Intake] Validation failed: ${validation.errors.join(', ')}`);
            return res.status(400).json({ error: validation.errors.join('. '), validationErrors: validation.errors });
        }
        if (validation.warnings.length > 0) {
            console.log(`[Intake] Validation warnings: ${validation.warnings.join(', ')}`);
        }
        // Override with corrected values
        const correctedPhone = validation.corrected.phone || phone;
        const correctedEmail = validation.corrected.email || email;
        const correctedName = validation.corrected.ownerName || ownerName;
        const correctedAddress = validation.corrected.propertyAddress || propertyAddress;

        // === Duplicate detection ===
        if (isSupabaseEnabled()) {
            try {
                const normalizedEmail = email.trim().toLowerCase();

                // Check by email
                const { data: emailMatches } = await supabaseAdmin
                    .from('submissions')
                    .select('case_id, property_address, email')
                    .ilike('email', normalizedEmail);

                if (emailMatches && emailMatches.length > 0) {
                    // Check if any existing submission has a similar address
                    const addressMatch = emailMatches.find(m => addressesMatch(propertyAddress, m.property_address));

                    if (addressMatch) {
                        console.log(`[Intake] Duplicate detected - email: ${normalizedEmail}, existing case: ${addressMatch.case_id}`);
                        return res.json({
                            duplicate: true,
                            caseId: addressMatch.case_id,
                            message: "We already have your property on file! Check your email for updates, or reply to our previous email."
                        });
                    }
                }
            } catch (dupErr) {
                console.error('[Intake] Duplicate check failed (proceeding):', dupErr.message);
            }
        }

        const caseId = await getNextCaseId();
        const state = detectState(source, county, req.body.state, propertyAddress);

        const submission = {
            id: uuidv4(),
            caseId,
            propertyAddress: correctedAddress,
            propertyType,
            ownerName: correctedName,
            phone: correctedPhone,
            email: correctedEmail,
            assessedValue: assessedValue || null,
            state,
            county: county || null,
            notificationPref: notificationPref || 'both',
            bedrooms: bedrooms ? parseInt(bedrooms) : null,
            bathrooms: bathrooms ? parseFloat(bathrooms) : null,
            sqft: sqft ? parseInt(sqft) : null,
            yearBuilt: yearBuilt ? parseInt(yearBuilt) : null,
            renovations: renovations || 'No',
            renovationDesc: renovationDesc || null,
            conditionIssues: conditionIssues || 'No',
            conditionDesc: conditionDesc || null,
            recentAppraisal: recentAppraisal || 'No',
            appraisedValue: appraisedValue || null,
            appraisalDate: appraisalDate || null,
            noticeFile: req.file ? `/uploads/${req.file.filename}` : null,
            noticeOfValue: null,
            source: source || 'website',
            utm_data: utm_data ? (typeof utm_data === 'string' ? JSON.parse(utm_data) : utm_data) : null,
            status: 'New',
            notes: [],
            savings: null,
            estimatedSavings: null,
            analysisReport: null,
            signature: null,
            pin: null,
            stripeCustomerId: stripeCustomerId || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Check for referral code
        if (ref && isSupabaseEnabled()) {
            try {
                const { data: referral } = await supabaseAdmin
                    .from('referrals')
                    .select('*')
                    .eq('referral_code', ref)
                    .single();

                if (referral) {
                    // Referral benefit: $50 credit toward fee (no rate discount)
                    submission.referralCode = ref;
                    submission.referralCredit = 50; // Flat $50 credit applied at billing
                    submission.referralId = referral.id;

                    // Link the referral to this new client
                    await supabaseAdmin
                        .from('referrals')
                        .update({
                            referred_email: email.toLowerCase(),
                            referred_name: ownerName,
                            referred_phone: phone || null,
                            status: 'claimed'
                        })
                        .eq('id', referral.id);

                    console.log(`[Intake] Referral ${ref} applied - $50 credit toward fee`);
                }
            } catch (refErr) {
                console.log('[Intake] Referral lookup failed:', refErr.message);
            }
        }

        // Save Stripe customer ID to client record if provided (card on file)
        if (stripeCustomerId && isSupabaseEnabled()) {
            try {
                await supabaseAdmin
                    .from('clients')
                    .update({ stripe_customer_id: stripeCustomerId })
                    .eq('email', email.toLowerCase());
                console.log(`[Intake] Stripe customer ${stripeCustomerId} linked to ${email}`);
                
                // Set the payment method as default for the customer
                if (stripePaymentMethodId && process.env.STRIPE_SECRET_KEY) {
                    const stripeLib = require('stripe')(process.env.STRIPE_SECRET_KEY);
                    await stripeLib.customers.update(stripeCustomerId, {
                        invoice_settings: { default_payment_method: stripePaymentMethodId }
                    });
                    console.log(`[Intake] Default payment method set for ${email}`);
                }
            } catch (stripeErr) {
                console.log('[Intake] Stripe customer link failed:', stripeErr.message);
            }
        }

        await writeSubmission(submission);

        // Send notifications to Tyler
        const { sms, html } = buildNotificationContent(submission);
        sendNotificationSMS(sms);
        sendNotificationEmail('New OverAssessed Lead: ' + ownerName + ' (' + caseId + ')', html);

        // Real-time Telegram alert (immediate)
        sendTelegramAlert(buildTelegramLeadAlert(submission));

        // Send welcome notification to client via stage notification engine
        const notifyFns = { sendClientSMS, sendClientEmail, brandedEmailWrapper };
        sendStageNotification(submission, 'submitted', {}, notifyFns);

        // Also send the rich welcome email (existing branded flow)
        const welcomeHtml = buildWelcomeEmail(submission);
        sendClientEmail(email, `Welcome to OverAssessed - Case ${caseId}`, welcomeHtml);

        // Initiation Fee: Create Stripe checkout for $79 initiation fee
        // The fee is credited toward the final contingency fee
        let checkoutUrl = null;
        try {
            const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

            // Get the initiation fee price ID from the stripe module
            // We'll call the checkout endpoint logic directly here
            const stripeModule = require('./routes/stripe');

            // Create checkout session directly
            const products = await stripe.products.search({
                query: "name:'OverAssessed Initiation Fee'",
                limit: 1
            });

            if (products.data.length > 0) {
                const product = products.data[0];
                const prices = await stripe.prices.list({
                    product: product.id,
                    active: true,
                    limit: 1
                });

                if (prices.data.length > 0) {
                    const priceId = prices.data[0].id;
                    const baseUrl = process.env.APP_URL || 'https://disciplined-alignment-production.up.railway.app';

                    const session = await stripe.checkout.sessions.create({
                        payment_method_types: ['card'],
                        line_items: [{
                            price: priceId,
                            quantity: 1
                        }],
                        mode: 'payment',
                        customer_email: correctedEmail,
                        success_url: `${baseUrl}/payment-success.html?session_id={CHECKOUT_SESSION_ID}&submission_id=${submission.id}`,
                        cancel_url: `${baseUrl}/payment-cancel.html?submission_id=${submission.id}`,
                        metadata: {
                            submission_id: submission.id,
                            client_name: correctedName,
                            property_address: correctedAddress,
                            state: state || '',
                            county: county || '',
                            fee_type: 'initiation',
                            source: 'overassessed.ai'
                        }
                    });

                    checkoutUrl = session.url;
                    console.log(`[Intake] Stripe checkout created for ${caseId}: ${checkoutUrl}`);
                }
            }
        } catch (stripeErr) {
            console.error('[Intake] Failed to create Stripe checkout:', stripeErr.message);
        }

        // Queue analysis job for the worker system
        try {
            await supabaseAdmin.from('job_queue').insert({
                job_type: 'analyze_lead',
                payload: { lead_id: submission.id, case_id: caseId, address: propertyAddress, county: county || '', state: state || '' },
                priority: 3,
                status: 'pending'
            });
            console.log(`[Intake] Queued analyze_lead job for ${caseId}`);
        } catch (qErr) { console.error(`[Intake] Queue insert failed:`, qErr.message); }

        // Auto-trigger full analysis pipeline (async, don't block response)
        setTimeout(async () => {
            try {
                console.log(`[AutoAnalysis] Starting auto-analysis for new case ${caseId}`);
                // Run real comp engine + QA (no synthetic data)
                try {
                    const realResult = await fetchRealComps({ id: submission.id, property_address: propertyAddress, county: county || '', state: state || '', assessed_value: assessedValue });
                    const comps = realResult.comps || [];
                    const sav = realResult.estimated_savings?.annual || 0;
                    await supabaseAdmin.from('submissions').update({
                        comp_results: { comps: realResult.comps, value_range: realResult.value_range, confidence: realResult.confidence, fetched_at: realResult.fetched_at, data_sources: realResult.data_sources },
                        estimated_savings: sav,
                        data_sources: realResult.data_sources,
                        updated_at: new Date().toISOString()
                    }).eq('id', submission.id);
                    // Run QA
                    const updatedForQA = await findSubmission(submission.id);
                    if (updatedForQA) {
                        const qaResult = runQACheck(updatedForQA);
                        let autoStage = 'Needs Analysis';
                        if (qaResult.passed && comps.length >= 3 && sav > 0) autoStage = 'Filing Prepared';
                        else if (qaResult.passed && sav <= 0) autoStage = 'No Case';
                        else if (comps.length < 3) autoStage = 'Needs Analysis';
                        await supabaseAdmin.from('submissions').update({ qa_status: qaResult.passed ? 'passed' : 'failed', qa_result: qaResult, qa_run_at: new Date().toISOString(), status: autoStage }).eq('id', submission.id);
                        console.log(`[AutoAnalysis] Real comp engine: ${comps.length} comps, $${sav}/yr, stage=${autoStage} for ${caseId}`);
                    }
                } catch (realErr) { console.error(`[AutoAnalysis] Real comp engine failed for ${caseId}:`, realErr.message); }
                await runFullAnalysis(submission.id);
                console.log(`[AutoAnalysis] Complete for ${caseId}`);
                // Notify Tyler that analysis is ready
                sendNotificationSMS(`📊 Auto-analysis complete!\nCase: ${caseId}\nProperty: ${propertyAddress}\nEvidence packet ready for review.`);
                sendNotificationEmail(`📊 Analysis Ready - ${caseId} ${ownerName}`,
                    `<p>Auto-analysis complete for <strong>${caseId}</strong> - ${propertyAddress}.</p>
                    <p>Evidence packet is generated and ready for review in the admin dashboard.</p>`);
                // Notify CLIENT that their analysis is ready (was missing - bug fix 2026-03-10)
                const updatedSub = await findSubmission(submission.id);
                if (updatedSub) {
                    const notifyFns = { sendClientSMS, sendClientEmail, brandedEmailWrapper };
                    const template = buildStatusEmail(updatedSub, 'Analysis Complete', {});
                    if (template) {
                        sendClientEmail(email, `${template.title} - ${caseId}`, brandedEmailWrapper(template.title, template.subtitle, template.body));
                        sendClientSMS(phone, template.sms);
                        console.log(`[AutoAnalysis] Client notification sent to ${email} for ${caseId}`);
                    }
                }
            } catch (err) {
                console.error(`[AutoAnalysis] Failed for ${caseId}:`, err.message);
            }
        }, 2000);

        res.json({
            success: true,
            message: 'Submitted successfully',
            id: submission.id,
            caseId,
            checkout_url: checkoutUrl,
            requires_payment: true
        });
    } catch (error) {
        console.error('Intake error:', error);
        res.status(500).json({ error: 'Failed to process submission' });
    }
});

// ==================== E-SIGNATURE (Form 50-162) ====================
// GET signing data
app.get('/api/sign/:id', async (req, res) => {
    try {
        const sub = await findSubmission(req.params.id);
        if (!sub) return res.status(404).json({ error: 'Case not found' });

        res.json({
            caseId: sub.caseId,
            ownerName: sub.ownerName,
            propertyAddress: sub.propertyAddress,
            email: sub.email,
            phone: sub.phone,
            propertyType: sub.propertyType,
            state: sub.state || 'TX',
            county: sub.county || null,
            signed: !!sub.signature,
            feeAgreementSigned: !!sub.feeAgreementSignature,
            feeRate: sub.discountedRate || sub.discounted_rate || null
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to load signing data' });
    }
});

// ==================== COMMERCIAL INTAKE ====================
app.post('/api/commercial-intake', async (req, res) => {
    try {
        const { name, companyName, email, phone, propertyAddress, propertyType, assessedValue, propertyCount, heardAbout, notes, utm_data } = req.body;

        if (!name || !email || !phone || !propertyAddress || !propertyType) {
            return res.status(400).json({ error: 'Missing required fields: name, email, phone, propertyAddress, propertyType' });
        }

        const leadId = uuidv4();
        const state = detectState('commercial', req.body.county, req.body.state, req.body.propertyAddress);
        const caseId = await getNextCaseId();

        // Save to submissions table with source='commercial'
        const submission = {
            id: leadId,
            caseId,
            propertyAddress,
            propertyType,
            ownerName: name,
            phone,
            email,
            assessedValue: assessedValue || null,
            state,
            county: null,
            notificationPref: 'both',
            source: 'commercial',
            status: 'New',
            notes: notes ? [{ text: `Company: ${companyName || 'N/A'} | Properties: ${propertyCount || '1'} | Heard via: ${heardAbout || 'N/A'} | Notes: ${notes}`, date: new Date().toISOString(), author: 'system' }] : (companyName ? [{ text: `Company: ${companyName} | Properties: ${propertyCount || '1'} | Heard via: ${heardAbout || 'N/A'}`, date: new Date().toISOString(), author: 'system' }] : []),
            utm_data: utm_data ? (typeof utm_data === 'string' ? JSON.parse(utm_data) : utm_data) : null,
            savings: null,
            estimatedSavings: null,
            analysisReport: null,
            signature: null,
            pin: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        await writeSubmission(submission);

        // Notify Tyler via SMS
        const smsMsg = `🏢 NEW COMMERCIAL LEAD!\n${name}${companyName ? ' (' + companyName + ')' : ''}\n${propertyType} - ${propertyAddress}\nValue: ${assessedValue || 'Not provided'}\nProperties: ${propertyCount || '1'}\nPhone: ${phone}\nEmail: ${email}\nCase: ${caseId}`;
        sendNotificationSMS(smsMsg);

        // Notify Tyler via email
        const emailHtml = `
            <h2 style="color:#6c5ce7;">🏢 New Commercial Property Tax Lead</h2>
            <table style="border-collapse:collapse;width:100%;max-width:600px;font-family:sans-serif;">
                <tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Case ID</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${caseId}</td></tr>
                <tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Name</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${name}</td></tr>
                <tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Company</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${companyName || 'N/A'}</td></tr>
                <tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Email</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${email}</td></tr>
                <tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Phone</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${phone}</td></tr>
                <tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Property Address</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${propertyAddress}</td></tr>
                <tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Property Type</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${propertyType}</td></tr>
                <tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Assessed Value</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${assessedValue || 'Not provided'}</td></tr>
                <tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;"># Properties</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${propertyCount || '1'}</td></tr>
                <tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Heard About Us</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${heardAbout || 'N/A'}</td></tr>
                ${notes ? `<tr><td style="padding:8px 12px;font-weight:bold;border-bottom:1px solid #eee;">Notes</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${notes}</td></tr>` : ''}
            </table>
        `;
        sendNotificationEmail('🏢 New Commercial Lead: ' + name + ' (' + caseId + ')', emailHtml);
        sendTelegramAlert(`🏢 COMMERCIAL LEAD\n\n<b>Name:</b> ${name}\n<b>Company:</b> ${companyName || '—'}\n<b>Email:</b> ${email}\n<b>Phone:</b> ${phone}\n<b>Property:</b> ${propertyAddress}\n<b>Assessed:</b> ${assessedValue || '—'}\n<b>Properties:</b> ${propertyCount || '1'}\n<b>Case:</b> ${caseId}\n\n➡️ Commercial lead — high value potential.`);

        // Send welcome notification to client
        const notifyFns = { sendClientSMS, sendClientEmail, brandedEmailWrapper };
        sendStageNotification(submission, 'submitted', {}, notifyFns);

        // Send welcome email
        const welcomeHtml = buildWelcomeEmail(submission);
        sendClientEmail(email, `Welcome to OverAssessed - Case ${caseId}`, welcomeHtml);

        // Auto-trigger analysis (async)
        setTimeout(async () => {
            try {
                console.log(`[AutoAnalysis] Starting auto-analysis for commercial case ${caseId}`);
                await runFullAnalysis(submission.id);
                console.log(`[AutoAnalysis] Complete for commercial ${caseId}`);
                sendNotificationSMS(`📊 Commercial auto-analysis complete!\nCase: ${caseId}\nProperty: ${propertyAddress}\nEvidence packet ready.`);
            } catch (err) {
                console.error(`[AutoAnalysis] Failed for commercial ${caseId}:`, err.message);
            }
        }, 2000);

        console.log(`[Commercial] New lead: ${caseId} - ${name} (${propertyType}) at ${propertyAddress}`);
        res.json({ success: true, caseId, message: 'Commercial intake received' });

    } catch (err) {
        console.error('[Commercial] Intake error:', err);
        res.status(500).json({ error: 'Failed to process commercial intake' });
    }
});

// POST submit signature
app.post('/api/sign/:id', async (req, res) => {
    try {
        const { fullName, authorized, email, feeAgreementName, feeAgreementAuthorized } = req.body;
        if (!fullName || !authorized) {
            return res.status(400).json({ error: 'Full name and authorization checkbox required' });
        }
        if (!feeAgreementName || !feeAgreementAuthorized) {
            return res.status(400).json({ error: 'Fee agreement signature is required. Please sign both agreements.' });
        }

        const sub = await updateSubmissionInPlace(req.params.id, (submissions, idx) => {
            const s = submissions[idx];
            const state = s.state || 'TX';
            const docsSigned = state === 'GA'
                ? ['service_agreement', 'letter_of_authorization']
                : ['form_50_162'];

            submissions[idx].signature = {
                fullName,
                authorized: true,
                signedAt: new Date().toISOString(),
                ipAddress: req.ip,
                documentsSigned: docsSigned
            };

            // Fee Agreement Signature - use client-specific rate if set, else state default
            const clientRate = s.discountedRate || s.discounted_rate;
            const feeRates = { TX: '25%', GA: '25%', WA: '25%', AZ: '25%', CO: '25%' };
            submissions[idx].feeAgreementSignature = {
                fullName: feeAgreementName,
                authorized: true,
                signedAt: new Date().toISOString(),
                ipAddress: req.ip,
                applicableRate: clientRate ? `${clientRate}%` : (feeRates[state] || '25%'),
                state: state
            };
            submissions[idx].fee_agreement_signed = true;
            submissions[idx].fee_agreement_signed_at = new Date().toISOString();

            if (['New', 'Analysis Complete', 'Contacted'].includes(submissions[idx].status)) {
                submissions[idx].status = 'Form Signed';
            }
            // Stop follow-up automation — customer engaged
            submissions[idx].customerReplied = true;
            submissions[idx].updatedAt = new Date().toISOString();
        });

        if (!sub) return res.status(404).json({ error: 'Case not found' });

        const state = sub.state || 'TX';
        const formName = state === 'GA' ? 'Service Agreement & Letter of Authorization' : 'Form 50-162';
        const feeRates = { TX: '25%', GA: '25%', WA: '25%', AZ: '25%', CO: '25%' };
        const clientRate2 = sub.discountedRate || sub.discounted_rate;
        const feeRate = clientRate2 ? `${clientRate2}%` : (feeRates[state] || '25%');

        // Notify Tyler
        sendNotificationEmail(
            `${formName} + Fee Agreement Signed - ${sub.caseId} ${sub.ownerName}`,
            `<div style="font-family:Arial;max-width:600px;">
                <div style="background:linear-gradient(135deg,#6c5ce7,#0984e3);color:white;padding:20px;border-radius:8px 8px 0 0;">
                    <h3 style="margin:0;">✍️ ${formName} + Fee Agreement Signed</h3>
                </div>
                <div style="background:#f7fafc;padding:20px;">
                    <p><strong>Case:</strong> ${sub.caseId}</p>
                    <p><strong>State:</strong> ${state}</p>
                    <p><strong>Client:</strong> ${sub.ownerName}</p>
                    <p><strong>Property:</strong> ${sub.propertyAddress}</p>
                    <p><strong>Authorization Signed:</strong> ${fullName}</p>
                    <p><strong>Fee Agreement Signed:</strong> ${feeAgreementName} (${feeRate} contingency)</p>
                    <p><strong>Signed At:</strong> ${new Date().toLocaleString()}</p>
                    <p style="margin-top:12px;padding:12px;background:#e8f5e9;border-radius:8px;"><strong>✅ Both agreements signed - ready for auto-charge on savings confirmation</strong></p>
                </div>
            </div>`
        );
        sendNotificationSMS(`✍️ ${formName} + Fee Agreement signed!\nCase: ${sub.caseId}\nClient: ${sub.ownerName}\nState: ${state}\nFee: ${feeRate} contingency`);

        // Send stage notification to client
        const notifyFns = { sendClientSMS, sendClientEmail, brandedEmailWrapper };
        sendStageNotification(sub, 'docs_signed', {}, notifyFns);

        res.json({ success: true, message: 'Both agreements signed successfully' });
    } catch (error) {
        console.error('Signature error:', error);
        res.status(500).json({ error: 'Failed to submit signature' });
    }
});

// ==================== FULL ANALYSIS ENGINE ====================

// Helper: find submission and its state file (or Supabase row)
async function findSubmissionWithFile(idOrCaseId) {
    if (isSupabaseEnabled()) {
        try {
            const { data: rows, error } = await supabaseAdmin
                .from('submissions')
                .select('*')
                .or(buildIdFilter(idOrCaseId));
            if (error) throw error;
            if (rows && rows.length > 0) {
                const sub = rowToSubmission(rows[0]);
                // Return a compatible structure: submissions array with index 0
                // and a special _supabaseId for saving back
                return { file: '__supabase__', submissions: [sub], idx: 0, _supabaseId: rows[0].id };
            }
            return null;
        } catch (err) {
            console.error('[Submissions] Supabase findWithFile failed, falling back:', err.message);
        }
    }
    for (const file of [TX_SUBMISSIONS_FILE, GA_SUBMISSIONS_FILE]) {
        const submissions = await readJsonFile(file);
        const idx = submissions.findIndex(s => s.id === idOrCaseId || s.caseId === (idOrCaseId || '').toUpperCase());
        if (idx >= 0) return { file, submissions, idx };
    }
    return null;
}

// Run the complete analysis pipeline for a case
async function runFullAnalysis(caseId) {
    const found = await findSubmissionWithFile(caseId);
    if (!found) throw new Error('Case not found');
    let { file, submissions, idx } = found;

    const sub = submissions[idx];
    console.log(`[Analysis] Starting full analysis for ${sub.caseId}: ${sub.propertyAddress}`);

    // Helper to save progress
    async function saveProgress() {
        if (file === '__supabase__' && isSupabaseEnabled()) {
            try {
                const row = submissionToRow(submissions[idx]);
                await supabaseAdmin.from('submissions').update(row).eq('id', row.id);
                return;
            } catch (err) {
                console.error('[Analysis] Supabase saveProgress failed:', err.message);
            }
        }
        if (file !== '__supabase__') {
            await writeJsonFile(file, submissions);
        }
    }

    // Update status
    submissions[idx].analysisStatus = 'Analyzing';
    submissions[idx].updatedAt = new Date().toISOString();
    await saveProgress();

    // Step 1: Fetch property data (use stored client-provided data if available)
    let propertyData;
    const existingPD = sub.propertyData || sub.property_data;
    const hasClientData = existingPD && typeof existingPD === 'object' 
        && existingPD.source && existingPD.source.startsWith('client-notice')
        && existingPD.assessedValue > 0;
    
    if (hasClientData) {
        console.log(`[Analysis] Step 1: Using client-provided data (${existingPD.source}), assessed: $${existingPD.assessedValue}`);
        propertyData = existingPD;
    } else {
        console.log(`[Analysis] Step 1: Fetching property data...`);
        propertyData = await fetchPropertyData(sub);
    }
    submissions[idx].propertyData = propertyData;
    await saveProgress();

    // Step 2: Check if we have real assessed value - never use synthetic/default data
    const assessedNum = propertyData.assessedValue || parseInt((sub.assessedValue || '0').replace(/[^0-9]/g, '')) || 0;
    const hasRealValue = assessedNum > 0 && propertyData.source !== 'intake-fallback';

    if (!hasRealValue) {
        console.log(`[Analysis] No real assessed value for ${sub.caseId} — running PRELIMINARY analysis with best available data.`);
        // NEW RULE: Always produce preliminary analysis. Never return 0 comps or "needs data" without value.
        // Use comps from nearby sold homes to estimate value range.
        
        // Attempt comp search even without real assessed value
        let prelimComps = null;
        try {
            // Use a reasonable estimate or the fallback value for comp searching
            const estimateValue = assessedNum > 0 ? assessedNum : 350000;
            const searchData = { ...propertyData, assessedValue: estimateValue };
            prelimComps = await findComparables(searchData, sub);
        } catch (compErr) {
            console.warn(`[Analysis] Preliminary comp search failed for ${sub.caseId}:`, compErr.message);
        }
        
        const hasComps = prelimComps && prelimComps.comps && prelimComps.comps.length > 0;
        const compCount = hasComps ? prelimComps.comps.length : 0;
        const medianCompValue = hasComps 
            ? prelimComps.comps.map(c => c.assessedValue || c.salePrice || 0).sort((a,b) => a-b)[Math.floor(compCount/2)]
            : null;
        const lowComp = hasComps ? Math.min(...prelimComps.comps.map(c => c.assessedValue || c.salePrice || Infinity)) : null;
        const highComp = hasComps ? Math.max(...prelimComps.comps.map(c => c.assessedValue || c.salePrice || 0)) : null;
        
        // Build preliminary estimate
        const prelimReport = {
            type: 'preliminary',
            generatedAt: new Date().toISOString(),
            propertyAddress: sub.propertyAddress,
            state: sub.state,
            county: sub.county,
            dataSource: propertyData.source,
            estimatedMarketValueRange: medianCompValue ? { low: lowComp, median: medianCompValue, high: highComp } : null,
            compsFound: compCount,
            estimatedSavingsRange: medianCompValue && assessedNum > medianCompValue 
                ? { low: Math.round((assessedNum - highComp) * 0.025), high: Math.round((assessedNum - lowComp) * 0.025) }
                : { low: 0, high: 0, note: 'Need Notice of Appraised Value to calculate precise savings' },
            comparables: hasComps ? prelimComps.comps.slice(0, 5).map(c => ({
                address: c.address, value: c.assessedValue || c.salePrice, sqft: c.sqft, yearBuilt: c.yearBuilt
            })) : [],
            recommendation: 'PRELIMINARY — Upload your Notice of Appraised Value for a precise savings estimate.'
        };
        
        submissions[idx].analysisReport = prelimReport;
        submissions[idx].compResults = prelimComps;
        submissions[idx].status = 'Preliminary Analysis';
        submissions[idx].analysisStatus = 'Preliminary';
        submissions[idx].tags = [...(submissions[idx].tags || []), 'preliminary-analysis', 'needs-docs'];
        submissions[idx].updatedAt = new Date().toISOString();
        await saveProgress();
        
        // Update Supabase with preliminary results
        try {
            await supabaseAdmin.from('submissions').update({
                status: 'Preliminary Analysis',
                analysis_status: 'Preliminary',
                comp_results: prelimComps,
                analysis_report: prelimReport,
                estimated_savings: prelimReport.estimatedSavingsRange?.high || 0,
                needs_manual_review: true,
                updated_at: new Date().toISOString(),
                notes: `[${new Date().toISOString().split('T')[0]}] Preliminary analysis: ${compCount} comps found. Median comp value: $${medianCompValue?.toLocaleString() || 'N/A'}. Awaiting Notice of Appraised Value for precise estimate.`
            }).eq('case_id', sub.caseId);
        } catch (dbErr) {
            console.warn(`[Analysis] Supabase update failed for ${sub.caseId}:`, dbErr.message);
        }
        
        console.log(`[Analysis] Preliminary analysis complete for ${sub.caseId}: ${compCount} comps, median $${medianCompValue || 'N/A'}`);
        
        // Notify Tyler (internal)
        const { sms, html } = buildNotificationContent(sub);
        sendNotificationSMS(`[PRELIMINARY - ${compCount} comps] ${sms}`);
        
        return submissions[idx];
    }

    // Step 2b: Find comparables (only with real data)
    console.log(`[Analysis] Step 2: Finding comparable properties...`);
    const compResults = await findComparables(propertyData, sub);
    submissions[idx].compResults = compResults;
    submissions[idx].analysisStatus = 'Comps Found';
    await saveProgress();

    // Step 3: Generate evidence packet (only with real data)
    console.log(`[Analysis] Step 3: Generating evidence packet...`);
    const evidencePath = await generateEvidencePacket(sub, propertyData, compResults);
    submissions[idx].evidencePacketPath = evidencePath;
    submissions[idx].analysisStatus = 'Evidence Generated';
    await saveProgress();

    // Step 4: Build analysis report
    // assessedNum already validated above - guaranteed to be real
    const report = {
        generatedAt: new Date().toISOString(),
        propertyAddress: sub.propertyAddress,
        propertyType: propertyData.propertyType || sub.propertyType,
        currentAssessedValue: assessedNum,
        // Primary recommendation (best of both strategies)
        estimatedMarketValue: compResults.recommendedValue,
        estimatedReduction: compResults.reduction,
        estimatedTaxSavings: compResults.estimatedSavings,
        taxRate: compResults.taxRate,
        primaryStrategy: compResults.primaryStrategy || 'market_value',
        // Market Value analysis
        marketValueAnalysis: compResults.marketValueAnalysis ? {
            recommendedValue: compResults.marketValueAnalysis.recommendedValue,
            reduction: compResults.marketValueAnalysis.reduction,
            estimatedSavings: compResults.marketValueAnalysis.estimatedSavings,
            comps: (compResults.marketValueAnalysis.comps || []).map(c => ({
                address: c.address, value: c.assessedValue, adjustedValue: c.adjustedValue,
                sqft: c.sqft, yearBuilt: c.yearBuilt, score: c.score, pricePerSqft: c.pricePerSqft
            })),
            methodology: compResults.marketValueAnalysis.methodology
        } : null,
        // Equal & Uniform analysis (PSF-based)
        equalUniformAnalysis: compResults.equalUniformAnalysis ? {
            recommendedValue: compResults.equalUniformAnalysis.recommendedValue,
            reduction: compResults.equalUniformAnalysis.reduction,
            estimatedSavings: compResults.equalUniformAnalysis.estimatedSavings,
            medianPSF: compResults.equalUniformAnalysis.medianPSF,
            subjectPSF: compResults.equalUniformAnalysis.subjectPSF,
            psfDifference: compResults.equalUniformAnalysis.psfDifference,
            psfOverassessedPct: compResults.equalUniformAnalysis.psfOverassessedPct,
            compsUsed: compResults.equalUniformAnalysis.compsUsed,
            compsEvaluated: compResults.equalUniformAnalysis.compsEvaluated,
            comps: (compResults.equalUniformAnalysis.comps || []).slice(0, 20).map(c => ({
                address: c.address, sqft: c.sqft, yearBuilt: c.yearBuilt,
                assessedValue: c.assessedValue, improvementValue: c.improvementValue,
                compPSF: c.compPSF, adjustedValue: c.adjustedValue,
                adjustments: c.adjustments
            })),
            recommendation: compResults.equalUniformAnalysis.recommendation,
            methodology: compResults.equalUniformAnalysis.methodology
        } : null,
        // Legacy fields (backward compat)
        comparables: compResults.comps.map(c => ({
            address: c.address,
            value: c.assessedValue,
            adjustedValue: c.adjustedValue,
            sqft: c.sqft,
            yearBuilt: c.yearBuilt,
            score: c.score,
            pricePerSqft: c.pricePerSqft
        })),
        methodology: compResults.methodology,
        recommendation: compResults.estimatedSavings > 0
            ? 'PROTEST RECOMMENDED - Strong basis for reduction based on comparable sales analysis.'
            : 'Preliminary analysis did not identify clear savings. Additional data or appraisal notice may reveal opportunities.',
        reportHtml: buildAnalysisHtml(sub, propertyData, compResults)
    };

    submissions[idx].analysisReport = report;
    submissions[idx].estimatedSavings = compResults.estimatedSavings;
    if (compResults.needsManualReview) {
        submissions[idx].needsManualReview = true;
        submissions[idx].reviewReason = compResults.reviewReason;
    }
    if (compResults.unreliableData) {
        submissions[idx].unreliableData = true;
    }
    // ── 3-Outcome Post-Analysis Routing ──
    // Outcome 1: ANALYSIS FAILED — data lookup failed, incomplete input, no comps
    // Outcome 2: NO SAVINGS — valid analysis, property fairly assessed
    // Outcome 3: SAVINGS FOUND — normal flow
    if (submissions[idx].status === 'New') {
        const savings = compResults.estimatedSavings || 0;
        const hasComps = compResults.comps && compResults.comps.length > 0;
        const isUnreliable = compResults.unreliableData || submissions[idx].unreliableData;
        const hadDataFailure = !hasComps || isUnreliable || compResults.dataSourceFailed;
        
        if (hadDataFailure && savings <= 0) {
            // OUTCOME 1: ANALYSIS FAILED — bad data, not a valid result
            submissions[idx].status = 'Needs Data';
            submissions[idx].analysisOutcome = 'failed';
            submissions[idx].needsManualReview = true;
            submissions[idx].reviewReason = (submissions[idx].reviewReason || '') + 
                ' Analysis failed — missing comps, unreliable data, or data source error.';
            console.warn(`[Analysis] ${sub.caseId}: ANALYSIS FAILED — no comps or unreliable data. Status → Needs Data`);
            
            sendTelegramAlert(`🔴 ANALYSIS FAILED\n\n<b>Lead:</b> ${sub.ownerName}\n<b>Email:</b> ${sub.email}\n<b>Property:</b> ${sub.propertyAddress}\n<b>County:</b> ${sub.county || 'Unknown'}\n<b>Reason:</b> ${!hasComps ? 'No comparables found' : 'Unreliable data'}\n\nMoved to Needs Data. Info request email will be sent.`);
        } else if (savings <= 0 && hasComps && !isUnreliable) {
            // OUTCOME 2: NO SAVINGS from preliminary analysis
            // DO NOT tell the lead "no savings" — preliminary data may be incomplete
            // Instead: request more info (notice, details) before making any conclusion
            submissions[idx].status = 'Needs Data';
            submissions[idx].analysisOutcome = 'preliminary_no_savings';
            submissions[idx].needsManualReview = true;
            submissions[idx].reviewReason = (submissions[idx].reviewReason || '') + 
                ' Preliminary analysis found no savings, but this may change with full appraisal notice or additional property details.';
            console.log(`[Analysis] ${sub.caseId}: PRELIMINARY NO SAVINGS — requesting more data before concluding. Status → Needs Data`);
            
            sendTelegramAlert(`📊 <b>PRELIMINARY — No savings yet</b>\n\n<b>Lead:</b> ${sub.ownerName}\n<b>Email:</b> ${sub.email}\n<b>Property:</b> ${sub.propertyAddress}\n<b>Assessed:</b> $${assessedNum.toLocaleString()}\n\n⚠️ <b>NOT telling lead "no savings."</b>\nRequesting appraisal notice + details first.\nFull analysis may reveal opportunities.`);
            
            // Send "need more info" email instead of "no protest" email
            if (sub.email && !sub.email.includes('benchmark@')) {
                try {
                    const needMoreInfoHtml = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a2e;">
  <div style="background: #6c5ce7; padding: 16px 24px; border-radius: 8px 8px 0 0;">
    <span style="color: white; font-weight: 700; font-size: 18px;">OVERASSESSED</span>
  </div>
  <div style="border: 1px solid #e0e0e8; border-top: none; border-radius: 0 0 8px 8px; padding: 24px;">
    <p style="font-size: 16px;">Hi ${sub.ownerName},</p>
    <p style="font-size: 15px; line-height: 1.6;">We've started analyzing your property at <strong>${sub.propertyAddress}</strong>. Our preliminary review is in — but to give you an accurate recommendation, we need a bit more information.</p>
    <div style="background: #fff8e1; border: 2px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 24px 0;">
      <p style="font-size: 15px; font-weight: 600; color: #b45309; margin: 0;">What we need from you:</p>
      <ul style="font-size: 14px; color: #4a4a68; margin: 8px 0 0; padding-left: 20px;">
        <li>Your official appraisal notice (when you receive it)</li>
        <li>Any details about your property's condition, recent renovations, or issues</li>
        <li>Confirm your county name if not already provided</li>
      </ul>
    </div>
    <p style="font-size: 15px; line-height: 1.6;">Many homeowners see significant savings once we compare their official notice against comparable sales. We want to make sure we're giving you the most accurate assessment possible.</p>
    <p style="font-size: 15px; line-height: 1.6;"><strong>Just reply to this email</strong> with any additional details, and we'll complete your full analysis right away.</p>
    <p style="font-size: 13px; color: #7c7c96; margin-top: 24px;">— The OverAssessed Team<br>
    <a href="https://overassessed.ai" style="color: #6c5ce7;">overassessed.ai</a></p>
  </div>
</div>`;
                    await sendClientEmail(sub.email, 'Almost done — we need a few details to finalize your analysis', needMoreInfoHtml);
                    console.log(`[Analysis] ${sub.caseId}: "Need more info" email sent (NOT "no savings")`);
                    submissions[idx].follow_up_note = `Preliminary analysis found no savings. Requesting more data. Follow up in 2 days if no reply.`;
                    submissions[idx].follow_up_date = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                } catch (emailErr) {
                    console.error(`[Analysis] ${sub.caseId}: Failed to send need-more-info email:`, emailErr.message);
                }
            }
        } else {
            // OUTCOME 3: SAVINGS FOUND — normal flow
            submissions[idx].status = 'Analysis Complete';
            submissions[idx].analysisOutcome = 'savings_found';
            console.log(`[Analysis] ${sub.caseId}: SAVINGS FOUND — $${savings.toLocaleString()}/yr. Status → Analysis Complete`);
        }
    }
    submissions[idx].updatedAt = new Date().toISOString();
    await saveProgress();

    // ── Missing Data Detection → Info Request Email ──
    // If key property data is missing, E&U was skipped. Ask customer for details to unlock deeper analysis.
    const missingFields = [];
    if (!propertyData.sqft || propertyData.sqft <= 0) missingFields.push('square footage');
    if (!propertyData.yearBuilt || propertyData.yearBuilt <= 0) missingFields.push('year built');
    if (!propertyData.bedrooms) missingFields.push('number of bedrooms');
    if (!propertyData.bathrooms) missingFields.push('number of bathrooms');

    if (missingFields.length > 0 && sub.email) {
        console.log(`[Analysis] ${sub.caseId}: Missing data (${missingFields.join(', ')}) - sending info request email`);
        submissions[idx].missingDataRequested = true;
        submissions[idx].missingFields = missingFields;
        await saveProgress();

        const mvSavings = compResults.marketValueAnalysis?.estimatedSavings || compResults.estimatedSavings || 0;
        const missingList = missingFields.map(f => `• ${f.charAt(0).toUpperCase() + f.slice(1)}`).join('<br>');

        const infoRequestHtml = `
            <p>Hi ${sub.ownerName},</p>
            <p>Great news - we've completed an initial analysis of your property at <strong>${sub.propertyAddress}</strong> and found potential savings of <strong>$${mvSavings.toLocaleString()}/year</strong>.</p>

            <div style="background:#f8f9ff;border:2px solid #00b894;border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
                <p style="margin:0 0 5px;color:#6b7280;">Initial Estimated Savings</p>
                <p style="margin:0;font-size:32px;font-weight:800;color:#00b894;">$${mvSavings.toLocaleString()}/year</p>
            </div>

            <p>However, we may be able to find you <strong>even more savings</strong> using an additional analysis method called Equal & Uniform (§42.26). To run this deeper analysis, we need a few details about your home:</p>

            <div style="background:#f0f9ff;border-left:4px solid #0984e3;padding:16px 20px;margin:20px 0;border-radius:4px;">
                <p style="margin:0;font-weight:700;color:#0984e3;">Please reply with:</p>
                <p style="margin:8px 0 0;line-height:2;">${missingList}</p>
                ${!propertyData.sqft ? '<p style="margin:8px 0 0;color:#666;font-size:13px;">Tip: Square footage is usually on your county tax statement or Zillow/Redfin listing.</p>' : ''}
            </div>

            <p>Just reply to this email with the details and we'll update your analysis right away. This could significantly increase your savings.</p>

            <p>Either way, your current analysis is ready. You can sign your authorization form now to lock in the $${mvSavings.toLocaleString()}/year savings, and we'll update it if you provide additional details:</p>

            <div style="text-align:center;margin:20px 0;">
                <a href="${getBaseUrl()}/sign/${sub.caseId}" style="background:linear-gradient(135deg,#6c5ce7,#0984e3);color:white;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:700;">Sign Authorization Form →</a>
            </div>
        `;

        try {
            await sendNotificationEmail(
                `${sub.ownerName} - We Found $${mvSavings.toLocaleString()}/yr Savings (+ Potential for More)`,
                infoRequestHtml,
                sub.email
            );
            console.log(`[Analysis] Info request email sent to ${sub.email} for ${sub.caseId}`);
        } catch(e) {
            console.error(`[Analysis] Failed to send info request email for ${sub.caseId}:`, e.message);
        }
    }

    console.log(`[Analysis] Complete for ${sub.caseId}. Savings: $${compResults.estimatedSavings}`);
    return { report, propertyData, compResults, evidencePath };
}

function buildEUHtmlSection(compResults, assessedNum) {
    const eu = compResults.equalUniformAnalysis;
    if (!eu || !eu.recommendedValue) return '';

    const isPrimary = compResults.primaryStrategy === 'equal_and_uniform';
    const euComps = (eu.comps || []).slice(0, 15); // Show up to 15 in HTML

    return `
        <div style="margin-bottom: 12px;">
            <div style="font-weight: 700; font-size: 12px; margin-bottom: 4px; color: ${isPrimary ? '#6c5ce7' : '#1a1a2e'};">
                Equal & Uniform Analysis (§42.26) ${isPrimary ? '★ PRIMARY' : ''}
            </div>
            
            <!-- E&U Metrics -->
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 8px;">
                <tr>
                    <td style="background: #f0eeff; padding: 6px 10px; border: 1px solid #d5d0f5; width: 33%; text-align: center;">
                        <div style="font-size: 8px; color: #7c7c96; text-transform: uppercase;">Subject $/SqFt</div>
                        <div style="font-size: 14px; font-weight: 800; color: #e17055; margin-top: 2px;">$${eu.subjectPSF || '-'}</div>
                    </td>
                    <td style="background: #f0eeff; padding: 6px 10px; border: 1px solid #d5d0f5; width: 33%; text-align: center;">
                        <div style="font-size: 8px; color: #7c7c96; text-transform: uppercase;">Median Comp $/SqFt</div>
                        <div style="font-size: 14px; font-weight: 800; color: #00b894; margin-top: 2px;">$${eu.medianPSF || '-'}</div>
                    </td>
                    <td style="background: #f0eeff; padding: 6px 10px; border: 1px solid #d5d0f5; width: 33%; text-align: center;">
                        <div style="font-size: 8px; color: #7c7c96; text-transform: uppercase;">E&U Recommended</div>
                        <div style="font-size: 14px; font-weight: 800; color: #0984e3; margin-top: 2px;">$${(eu.recommendedValue || 0).toLocaleString()}</div>
                    </td>
                </tr>
            </table>

            ${eu.psfDifference ? `
            <div style="background: #fff3e0; border-left: 3px solid #ff9800; padding: 6px 12px; margin-bottom: 8px; font-size: 10px;">
                <strong>Equity Argument:</strong> Subject is assessed $${eu.psfDifference}/sqft higher than the median of ${eu.compsUsed || 0} comparable properties
                ${eu.psfOverassessedPct ? ` (${(eu.psfOverassessedPct * 100).toFixed(1)}% above median)` : ''}.
                This constitutes unequal appraisal under TX Tax Code §42.26.
            </div>
            ` : ''}

            <!-- E&U Comps Table -->
            ${euComps.length > 0 ? `
            <div style="font-size: 10px; color: #7c7c96; margin-bottom: 3px;">${eu.compsUsed || euComps.length} comps selected from ${eu.compsEvaluated || 0} evaluated</div>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 10px;">
                <thead><tr style="background: #6c5ce7; color: white;">
                    <th style="padding: 4px 5px; text-align: left; font-size: 9px;">Address</th>
                    <th style="padding: 4px 5px; text-align: right; font-size: 9px;">Sq Ft</th>
                    <th style="padding: 4px 5px; text-align: right; font-size: 9px;">$/SqFt</th>
                    <th style="padding: 4px 5px; text-align: right; font-size: 9px;">Adj Value</th>
                    <th style="padding: 4px 5px; text-align: right; font-size: 9px;">Size Adj</th>
                    <th style="padding: 4px 5px; text-align: right; font-size: 9px;">Age Adj</th>
                    <th style="padding: 4px 5px; text-align: right; font-size: 9px;">Land Adj</th>
                </tr></thead>
                <tbody>
                    ${euComps.map((c, i) => `<tr style="background: ${i % 2 ? '#f7f7fc' : 'white'};">
                        <td style="padding: 3px 5px; font-size: 9px;">${(c.address || '').substring(0, 30)}</td>
                        <td style="padding: 3px 5px; text-align: right; font-size: 9px;">${c.sqft ? c.sqft.toLocaleString() : '-'}</td>
                        <td style="padding: 3px 5px; text-align: right; font-size: 9px;">$${c.compPSF || '-'}</td>
                        <td style="padding: 3px 5px; text-align: right; font-size: 9px; font-weight: 600; color: ${(c.adjustedValue || 0) < assessedNum ? '#00b894' : '#e17055'};">$${(c.adjustedValue || 0).toLocaleString()}</td>
                        <td style="padding: 3px 5px; text-align: right; font-size: 9px; color: ${(c.adjustments?.size || 0) >= 0 ? '#00b894' : '#e17055'};">${c.adjustments ? (c.adjustments.size >= 0 ? '+' : '') + '$' + Math.abs(c.adjustments.size || 0).toLocaleString() : '-'}</td>
                        <td style="padding: 3px 5px; text-align: right; font-size: 9px; color: ${(c.adjustments?.age || 0) >= 0 ? '#00b894' : '#e17055'};">${c.adjustments ? (c.adjustments.age >= 0 ? '+' : '') + '$' + Math.abs(c.adjustments.age || 0).toLocaleString() : '-'}</td>
                        <td style="padding: 3px 5px; text-align: right; font-size: 9px; color: ${(c.adjustments?.land || 0) >= 0 ? '#00b894' : '#e17055'};">${c.adjustments ? (c.adjustments.land >= 0 ? '+' : '') + '$' + Math.abs(c.adjustments.land || 0).toLocaleString() : '-'}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
            ` : ''}
        </div>`;
}

function buildAnalysisHtml(sub, propertyData, compResults) {
    const assessedNum = propertyData.assessedValue || 0;
    const isRecommended = (compResults.estimatedSavings || 0) > 0;
    const strategyLabel = compResults.primaryStrategy === 'equal_and_uniform' ? 'Equal & Uniform (§42.26)' : 'Market Value Approach';

    return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; color: #1a1a2e;">
    <div style="background: #6c5ce7; padding: 14px 20px; border-radius: 8px 8px 0 0;">
        <span style="color: white; font-weight: 700; font-size: 15px;">OVERASSESSED</span>
        <span style="color: rgba(255,255,255,0.7); font-size: 11px; margin-left: 6px;">Evidence Packet</span>
    </div>
    <div style="border: 1px solid #e0e0e8; border-top: none; border-radius: 0 0 8px 8px; padding: 16px 20px;">

        <!-- Property Info -->
        <table style="width: 100%; font-size: 12px; margin-bottom: 12px; border-collapse: collapse;">
            <tr>
                <td style="padding: 2px 0; color: #7c7c96; width: 50%;">Owner: <strong style="color: #1a1a2e;">${sub.ownerName}</strong></td>
                <td style="padding: 2px 0; color: #7c7c96; text-align: right;">Case: <strong style="color: #1a1a2e;">${sub.caseId}</strong></td>
            </tr>
            <tr>
                <td style="padding: 2px 0; color: #7c7c96;">Address: <strong style="color: #1a1a2e;">${sub.propertyAddress}</strong></td>
                <td style="padding: 2px 0; color: #7c7c96; text-align: right;">${new Date().toLocaleDateString()}</td>
            </tr>
        </table>

        <!-- Value Summary -->
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px;">
            <tr>
                <td style="background: #f7f7fc; padding: 8px 10px; border: 1px solid #e0e0e8; width: 25%; text-align: center;">
                    <div style="font-size: 9px; color: #7c7c96; text-transform: uppercase;">Current Assessed</div>
                    <div style="font-size: 16px; font-weight: 800; margin-top: 2px;">$${assessedNum.toLocaleString()}</div>
                </td>
                <td style="background: #f7f7fc; padding: 8px 10px; border: 1px solid #e0e0e8; width: 25%; text-align: center;">
                    <div style="font-size: 9px; color: #7c7c96; text-transform: uppercase;">Recommended</div>
                    <div style="font-size: 16px; font-weight: 800; color: #0984e3; margin-top: 2px;">$${(compResults.recommendedValue || 0).toLocaleString()}</div>
                </td>
                <td style="background: #f7f7fc; padding: 8px 10px; border: 1px solid #e0e0e8; width: 25%; text-align: center;">
                    <div style="font-size: 9px; color: #7c7c96; text-transform: uppercase;">Reduction</div>
                    <div style="font-size: 16px; font-weight: 800; color: #00b894; margin-top: 2px;">$${(compResults.reduction || 0).toLocaleString()}</div>
                </td>
                <td style="background: #00b894; padding: 8px 10px; border: 1px solid #00b894; width: 25%; text-align: center; color: white;">
                    <div style="font-size: 9px; opacity: 0.85; text-transform: uppercase;">Tax Savings</div>
                    <div style="font-size: 18px; font-weight: 900; margin-top: 2px;">$${(compResults.estimatedSavings || 0).toLocaleString()}</div>
                    <div style="font-size: 8px; opacity: 0.7;">/year</div>
                </td>
            </tr>
        </table>

        <!-- Comparables Table -->
        <div style="font-weight: 700; font-size: 12px; margin-bottom: 4px;">Comparable Properties</div>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 11px;">
            <thead><tr style="background: #6c5ce7; color: white;">
                ${(compResults.comps || []).some(c => c.accountId && !c.accountId.startsWith('R')) ? '<th style="padding: 5px 6px; text-align: left; font-size: 10px; font-weight: 600;">Account #</th>' : ''}
                <th style="padding: 5px 6px; text-align: left; font-size: 10px; font-weight: 600;">Address</th>
                <th style="padding: 5px 6px; text-align: right; font-size: 10px; font-weight: 600;">Assessed</th>
                <th style="padding: 5px 6px; text-align: right; font-size: 10px; font-weight: 600;">Adjusted</th>
                <th style="padding: 5px 6px; text-align: right; font-size: 10px; font-weight: 600;">Sq Ft</th>
                <th style="padding: 5px 6px; text-align: right; font-size: 10px; font-weight: 600;">Yr Built</th>
                <th style="padding: 5px 6px; text-align: right; font-size: 10px; font-weight: 600;">$/SqFt</th>
                <th style="padding: 5px 6px; text-align: center; font-size: 10px; font-weight: 600;">Score</th>
            </tr></thead>
            <tbody>
                ${(compResults.comps || []).map((c, i) => `<tr style="background: ${i % 2 ? '#f7f7fc' : 'white'};">
                    ${(compResults.comps || []).some(c => c.accountId && !c.accountId.startsWith('R')) ? `<td style="padding: 4px 6px; font-size: 10px; font-weight: 700; color: #6c5ce7;">${c.accountId || '-'}</td>` : ''}
                    <td style="padding: 4px 6px; font-size: 10px;">${c.address}</td>
                    <td style="padding: 4px 6px; text-align: right; font-size: 10px;">$${(c.assessedValue || 0).toLocaleString()}</td>
                    <td style="padding: 4px 6px; text-align: right; font-size: 10px; font-weight: 700; color: ${(c.adjustedValue || 0) < assessedNum ? '#00b894' : '#e17055'};">$${(c.adjustedValue || 0).toLocaleString()}</td>
                    <td style="padding: 4px 6px; text-align: right; font-size: 10px;">${c.sqft ? c.sqft.toLocaleString() : '-'}</td>
                    <td style="padding: 4px 6px; text-align: right; font-size: 10px;">${c.yearBuilt || '-'}</td>
                    <td style="padding: 4px 6px; text-align: right; font-size: 10px;">${c.pricePerSqft ? '$' + c.pricePerSqft : '-'}</td>
                    <td style="padding: 4px 6px; text-align: center; font-size: 10px; font-weight: 700; color: #6c5ce7;">${c.score}</td>
                </tr>`).join('')}
            </tbody>
        </table>

        <!-- Equal & Uniform Section -->
        ${buildEUHtmlSection(compResults, assessedNum)}

        <!-- Methodology -->
        <div style="font-weight: 700; font-size: 12px; margin-bottom: 3px;">Methodology</div>
        <p style="color: #4a4a68; font-size: 11px; line-height: 1.5; margin: 0 0 12px;">${compResults.methodology}</p>

        <!-- Dual Strategy Summary -->
        ${compResults.equalUniformAnalysis && compResults.marketValueAnalysis ? `
        <div style="background: #f0eeff; border: 1px solid #d5d0f5; border-radius: 6px; padding: 10px 14px; margin-bottom: 12px;">
            <div style="font-weight: 700; font-size: 11px; color: #6c5ce7; margin-bottom: 6px;">DUAL STRATEGY COMPARISON</div>
            <table style="width: 100%; font-size: 10px; border-collapse: collapse;">
                <tr>
                    <td style="padding: 3px 0; color: #4a4a68;">Market Value Approach:</td>
                    <td style="padding: 3px 0; text-align: right; font-weight: 600;">$${(compResults.marketValueAnalysis.recommendedValue || 0).toLocaleString()} <span style="color: #00b894;">(−$${(compResults.marketValueAnalysis.reduction || 0).toLocaleString()})</span></td>
                </tr>
                <tr>
                    <td style="padding: 3px 0; color: #4a4a68;">Equal & Uniform (§42.26):</td>
                    <td style="padding: 3px 0; text-align: right; font-weight: 600;">$${(compResults.equalUniformAnalysis.recommendedValue || 0).toLocaleString()} <span style="color: #00b894;">(−$${(compResults.equalUniformAnalysis.reduction || 0).toLocaleString()})</span></td>
                </tr>
                <tr style="border-top: 1px solid #d5d0f5;">
                    <td style="padding: 5px 0 2px; color: #6c5ce7; font-weight: 700;">★ Primary Strategy:</td>
                    <td style="padding: 5px 0 2px; text-align: right; font-weight: 700; color: #6c5ce7;">${strategyLabel}</td>
                </tr>
            </table>
        </div>
        ` : ''}

        <!-- Recommendation Badge -->
        <div style="background: ${isRecommended ? '#e6faf4' : '#ffeaea'}; border-left: 4px solid ${isRecommended ? '#00b894' : '#e17055'}; padding: 8px 14px; border-radius: 4px; margin-bottom: 10px;">
            <strong style="color: ${isRecommended ? '#00b894' : '#e17055'};">${isRecommended ? '✓ PROTEST RECOMMENDED' : '✗ NOT RECOMMENDED'}</strong>
            <span style="color: #7c7c96; font-size: 10px; float: right; margin-top: 2px;">Strategy: ${strategyLabel}</span>
        </div>

        <p style="color: #7c7c96; font-size: 9px; text-align: center; margin: 6px 0 0;">
            Prepared by OverAssessed LLC | overassessed.ai | Confidential
        </p>
    </div>
</div>`;
}

// Main analyze endpoint
app.post('/api/analyze/:id', authenticateToken, async (req, res) => {
    try {
        const result = await runFullAnalysis(req.params.id);

        // STANDING RULE: No client emails until analysis is manually reviewed and confirmed correct
        // All emails require Tyler's approval - no auto-sends on analysis completion
        const sub = await findSubmission(req.params.id);
        const hasFlags = result.unreliableData || (result.compResults && result.compResults.unreliableData);
        console.log(`[Analysis] ${sub?.caseId || req.params.id} - analysis complete. Unreliable: ${hasFlags}. Holding all client emails for manual review.`);

        res.json({ success: true, estimatedSavings: result.compResults.estimatedSavings, report: result.report });
    } catch (error) {
        console.error('Analysis error:', error);
        res.status(500).json({ error: 'Failed to run analysis: ' + error.message });
    }
});

// Alias: POST /api/cases/:id/analyze
app.post('/api/cases/:id/analyze', authenticateToken, async (req, res) => {
    try {
        const result = await runFullAnalysis(req.params.id);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET property data for a case
app.get('/api/cases/:id/property-data', authenticateToken, async (req, res) => {
    try {
        const submissions = await readAllSubmissions();
        const sub = submissions.find(s => s.id === req.params.id || s.caseId === (req.params.id || '').toUpperCase());
        if (!sub) return res.status(404).json({ error: 'Case not found' });
        res.json(sub.propertyData || { error: 'No property data yet. Run analysis first.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET comps for a case
app.get('/api/cases/:id/comps', authenticateToken, async (req, res) => {
    try {
        const submissions = await readAllSubmissions();
        const sub = submissions.find(s => s.id === req.params.id || s.caseId === (req.params.id || '').toUpperCase());
        if (!sub) return res.status(404).json({ error: 'Case not found' });
        res.json(sub.compResults || { error: 'No comp data yet. Run analysis first.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST generate evidence packet (standalone)
app.post('/api/cases/:id/generate-evidence', authenticateToken, async (req, res) => {
    try {
        const sub = await findSubmission(req.params.id);
        if (!sub) return res.status(404).json({ error: 'Case not found' });
        if (!sub.propertyData || !sub.compResults) return res.status(400).json({ error: 'Run analysis first' });

        const evidencePath = await generateEvidencePacket(sub, sub.propertyData, sub.compResults);
        await updateSubmissionInPlace(req.params.id, (submissions, idx) => {
            submissions[idx].evidencePacketPath = evidencePath;
            submissions[idx].analysisStatus = 'Evidence Generated';
            submissions[idx].updatedAt = new Date().toISOString();
        });

        res.json({ success: true, path: evidencePath });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET download evidence packet
app.get('/api/cases/:id/evidence-packet', (req, res, next) => {
    // Allow token via query param for direct download links
    if (req.query.token && !req.headers['authorization']) {
        req.headers['authorization'] = 'Bearer ' + req.query.token;
    }
    next();
}, authenticateToken, async (req, res) => {
    try {
        const submissions = await readAllSubmissions();
        const sub = submissions.find(s => s.id === req.params.id || s.caseId === (req.params.id || '').toUpperCase());
        if (!sub) return res.status(404).json({ error: 'Case not found' });
        if (!sub.evidencePacketPath) return res.status(404).json({ error: 'No evidence packet generated yet' });

        const filePath = sub.evidencePacketPath;
        try {
            await fs.access(filePath);
        } catch {
            return res.status(404).json({ error: 'Evidence file not found on disk' });
        }
        res.download(filePath);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST prepare filing package
app.post('/api/cases/:id/prepare-filing', authenticateToken, async (req, res) => {
    try {
        const sub = await findSubmission(req.params.id);
        if (!sub) return res.status(404).json({ error: 'Case not found' });
        if (!sub.propertyData || !sub.compResults) return res.status(400).json({ error: 'Run analysis first' });

        const filingData = await prepareFilingPackage(sub, sub.propertyData, sub.compResults);
        await updateSubmissionInPlace(req.params.id, (submissions, idx) => {
            submissions[idx].filingData = filingData;
            submissions[idx].analysisStatus = 'Ready to File';
            submissions[idx].updatedAt = new Date().toISOString();
        });

        res.json({ success: true, filingData });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET download filing package
app.get('/api/cases/:id/filing-package', (req, res, next) => {
    if (req.query.token && !req.headers['authorization']) {
        req.headers['authorization'] = 'Bearer ' + req.query.token;
    }
    next();
}, authenticateToken, async (req, res) => {
    try {
        const submissions = await readAllSubmissions();
        const sub = submissions.find(s => s.id === req.params.id || s.caseId === (req.params.id || '').toUpperCase());
        if (!sub || !sub.filingData || !sub.filingData.filingPdfPath) return res.status(404).json({ error: 'No filing package' });
        res.download(sub.filingData.filingPdfPath);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST bulk analyze
app.post('/api/cases/bulk-analyze', authenticateToken, async (req, res) => {
    try {
        const submissions = await readAllSubmissions();
        const newCases = submissions.filter(s => s.status === 'New' || s.analysisStatus === 'Not Started');
        const ids = (req.body.ids || newCases.map(s => s.id));

        const results = [];
        for (const id of ids) {
            try {
                await runFullAnalysis(id);
                results.push({ id, status: 'analyzed' });
            } catch (e) {
                results.push({ id, status: 'error', error: e.message });
            }
        }
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Legacy bulk analyze alias
app.post('/api/analyze-bulk', authenticateToken, async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !ids.length) return res.status(400).json({ error: 'No IDs provided' });
        const results = [];
        for (const id of ids) {
            try {
                await runFullAnalysis(id);
                results.push({ id, status: 'analyzed' });
            } catch (e) {
                results.push({ id, status: 'error', error: e.message });
            }
        }
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ error: 'Bulk analysis failed' });
    }
});

// ==================== NOTICE UPLOAD ====================
app.post('/api/upload-notice/:id', uploadNotice.single('notice'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const filePath = `/uploads/notices/${req.file.filename}`;
        const pinMatch = req.file.originalname.match(/(\d{6,})/);
        const sub = await updateSubmissionInPlace(req.params.id, (submissions, idx) => {
            submissions[idx].noticeOfValue = filePath;
            submissions[idx].updatedAt = new Date().toISOString();
            if (pinMatch) submissions[idx].pin = pinMatch[1];
        });
        if (!sub) return res.status(404).json({ error: 'Case not found' });

        sendNotificationEmail(
            `Notice Uploaded - ${sub.caseId}`,
            `<p>Client ${sub.ownerName} uploaded their Notice of Appraised Value for case ${sub.caseId}.</p>`
        );

        // ── AUTO-FILE TRIGGER: If case is signed + has notice → prepare filing ──
        const canAutoFile = ['Signed', 'Form Signed'].includes(sub.status) && filePath;
        if (canAutoFile) {
            console.log(`[AutoFile] 🚀 Notice received for signed case ${sub.caseId} — triggering auto-file preparation`);
            try {
                const { prepareFilingPackage } = require('./services/auto-file');
                const filingPkg = await prepareFilingPackage(
                    { caseId: sub.caseId, ownerName: sub.ownerName, propertyAddress: sub.propertyAddress, pin: sub.pin },
                    { address: sub.propertyAddress, assessedValue: sub.assessedValue, accountId: sub.pin },
                    { recommendedValue: null, reduction: sub.estimatedSavings, estimatedSavings: sub.estimatedSavings, comps: [] }
                );
                console.log(`[AutoFile] ✅ Filing package prepared for ${sub.caseId}`);
                sendNotificationEmail(
                    `🚀 AUTO-FILE READY - ${sub.caseId}`,
                    `<p>Notice uploaded + case signed. Filing package auto-generated for <b>${sub.caseId}</b> (${sub.ownerName}).</p>
                     <p><b>County:</b> ${sub.county || 'unknown'} | <b>State:</b> ${sub.state}</p>
                     <p>Ready to submit to county portal. Review and approve filing.</p>`
                );
            } catch (afErr) {
                console.error(`[AutoFile] Error preparing filing for ${sub.caseId}:`, afErr.message);
            }
        }

        res.json({ success: true, message: 'Notice uploaded', filePath, autoFileTriggered: canAutoFile });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Failed to upload notice' });
    }
});

// ==================== PIPELINE STATS ====================
app.get('/api/pipeline-stats', authenticateToken, async (req, res) => {
    try {
        const allSubmissions = await readAllSubmissions();
        // Exclude benchmark/test data from pipeline stats
        const submissions = allSubmissions.filter(s => 
            s.source !== 'stephen-benchmark' && 
            !(s.email && (s.email.includes('benchmark@') || s.email.includes('test@')))
        );
        
        // Use ACTUAL DB stages — no remapping
        const statuses = ['New', 'Contacted', 'Analysis Complete', 'Form Signed', 'Filing Prepared', 'Submitted', 'Needs Data', 'Duplicate', 'Hearing Scheduled', 'Won', 'Lost'];
        const pipeline = {};
        statuses.forEach(s => pipeline[s] = 0);
        submissions.forEach(s => {
            if (s.status === 'Deleted') return;
            if (pipeline[s.status] !== undefined) {
                pipeline[s.status]++;
            }
            // Don't remap or bucket unknown stages — just skip
        });

        const totalEstimatedSavings = submissions.reduce((sum, s) => sum + (s.estimatedSavings || s.estimated_savings || 0), 0);
        const totalFees = submissions.reduce((sum, s) => {
            const rate = s.feeRate || s.fee_rate || 0.25;
            return sum + Math.round((s.estimatedSavings || s.estimated_savings || 0) * rate);
        }, 0);
        // Signed = fee_agreement_signed OR stage in (Form Signed, Filing Prepared)
        const signed = submissions.filter(s => s.feeAgreementSigned || s.fee_agreement_signed || ['Form Signed', 'Filing Prepared'].includes(s.status)).length;
        const notices = submissions.filter(s => s.noticeOfValue || s.notice_of_value).length;

        res.json({ pipeline, totalEstimatedSavings, totalFees, signed, notices, total: submissions.length });
    } catch (error) {
        res.status(500).json({ error: 'Failed to compute pipeline stats' });
    }
});

// ==================== STATUS UPDATE (with client notifications) ====================
app.patch('/api/submissions/:id/status', authenticateToken, async (req, res) => {
    try {
        const { status, savings } = req.body;
        if (!status) return res.status(400).json({ error: 'Status required' });

        let oldStatus = null;
        const sub = await updateSubmissionInPlace(req.params.id, (submissions, idx) => {
            oldStatus = submissions[idx].status;
            submissions[idx].status = status;
            if (savings !== undefined) submissions[idx].savings = savings;
            submissions[idx].updatedAt = new Date().toISOString();
        });
        if (!sub) return res.status(404).json({ error: 'Not found' });

        // Send status notification to client if status actually changed
        if (oldStatus !== status) {
            const template = buildStatusEmail(sub, status, { savings: savings || sub.savings });
            if (template) {
                sendClientEmail(sub.email, `${template.title} - ${sub.caseId}`, brandedEmailWrapper(template.title, template.subtitle, template.body));
                sendClientSMS(sub.phone, template.sms, { email: sub.email, customerName: sub.ownerName, context: 'status_notification' });
                console.log(`Status notification sent to ${sub.email} for ${status}`);
            }

            // ── AUTO-FILE TRIGGER: Status changed to Signed + notice exists → prepare filing ──
            if (['Signed', 'Form Signed'].includes(status) && sub.noticeOfValue) {
                console.log(`[AutoFile] 🚀 Case ${sub.caseId} signed + notice on file — triggering auto-file`);
                try {
                    const { prepareFilingPackage } = require('./services/auto-file');
                    const filingPkg = await prepareFilingPackage(
                        { caseId: sub.caseId, ownerName: sub.ownerName, propertyAddress: sub.propertyAddress, pin: sub.pin },
                        { address: sub.propertyAddress, assessedValue: sub.assessedValue, accountId: sub.pin },
                        { recommendedValue: null, reduction: sub.estimatedSavings, estimatedSavings: sub.estimatedSavings, comps: [] }
                    );
                    console.log(`[AutoFile] ✅ Filing package prepared for ${sub.caseId}`);
                    sendNotificationEmail(
                        `🚀 AUTO-FILE READY - ${sub.caseId}`,
                        `<p>Case signed + notice on file. Filing package auto-generated for <b>${sub.caseId}</b> (${sub.ownerName}).</p>
                         <p><b>County:</b> ${sub.county || 'unknown'} | <b>State:</b> ${sub.state}</p>
                         <p>Ready to submit to county portal.</p>`
                    );
                } catch (afErr) {
                    console.error(`[AutoFile] Error preparing filing for ${sub.caseId}:`, afErr.message);
                }
            }
        }

        res.json(sub);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update status' });
    }
});

// ==================== EXISTING ROUTES (kept) ====================
app.get('/api/submissions', authenticateToken, async (req, res) => {
    try {
        let submissions = await readAllSubmissions();
        // Exclude benchmark/test data from admin view
        submissions = submissions.filter(s => 
            s.source !== 'stephen-benchmark' && 
            !(s.email && (s.email.includes('benchmark@') || s.email.includes('test@')))
        );
        const stateFilter = req.query.state;
        if (stateFilter && stateFilter !== 'all') {
            submissions = submissions.filter(s => (s.state || 'TX') === stateFilter.toUpperCase());
        }
        submissions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(submissions);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch submissions' });
    }
});

// These must be BEFORE :id routes so Express doesn't match "deleted"/"follow-ups-due" as an :id
// GET /api/submissions/deleted - list soft-deleted records
app.get('/api/submissions/deleted', authenticateToken, async (req, res) => {
    try {
        if (isSupabaseEnabled()) {
            const { data, error } = await supabaseAdmin
                .from('submissions')
                .select('*')
                .not('deleted_at', 'is', null)
                .order('deleted_at', { ascending: false });
            if (error) throw error;
            return res.json((data || []).map(rowToSubmission));
        }
        res.json([]);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch deleted submissions' });
    }
});

// GET /api/submissions/follow-ups-due - leads with follow_up_date <= today
app.get('/api/submissions/follow-ups-due', authenticateToken, async (req, res) => {
    try {
        if (isSupabaseEnabled()) {
            const today = new Date().toISOString().split('T')[0];
            const { data, error } = await supabaseAdmin
                .from('submissions')
                .select('*')
                .is('deleted_at', null)
                .not('follow_up_date', 'is', null)
                .lte('follow_up_date', today)
                .order('follow_up_date', { ascending: true });
            if (error) throw error;
            return res.json((data || []).map(rowToSubmission));
        }
        res.json([]);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch follow-ups' });
    }
});

app.get('/api/submissions/:id', authenticateToken, async (req, res) => {
    try {
        const sub = await findSubmission(req.params.id);
        if (!sub) return res.status(404).json({ error: 'Not found' });
        res.json(sub);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch submission' });
    }
});

app.patch('/api/submissions/:id', authenticateToken, async (req, res) => {
    try {
        const { status, note, savings } = req.body;
        let oldStatus = null;
        const sub = await updateSubmissionInPlace(req.params.id, (submissions, idx) => {
            oldStatus = submissions[idx].status;
            if (status) submissions[idx].status = status;
            if (savings !== undefined) submissions[idx].savings = savings;
            if (note) {
                submissions[idx].notes.push({
                    id: uuidv4(),
                    text: note,
                    author: req.user.email,
                    createdAt: new Date().toISOString()
                });
            }
            submissions[idx].updatedAt = new Date().toISOString();
        });
        if (!sub) return res.status(404).json({ error: 'Not found' });

        // Send status notification to client if status changed
        if (status && oldStatus !== status) {
            const template = buildStatusEmail(sub, status, { savings: savings || sub.savings });
            if (template) {
                sendClientEmail(sub.email, `${template.title} - ${sub.caseId}`, brandedEmailWrapper(template.title, template.subtitle, template.body));
                sendClientSMS(sub.phone, template.sms, { email: sub.email, customerName: sub.ownerName, context: 'status_notification' });
            }
        }

        res.json(sub);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update submission' });
    }
});

// ==================== SOFT DELETE ENDPOINTS ====================
// DELETE /api/submissions/:id - soft delete (set deleted_at)
app.delete('/api/submissions/:id', authenticateToken, async (req, res) => {
    try {
        if (isSupabaseEnabled()) {
            const { data, error } = await supabaseAdmin
                .from('submissions')
                .update({ deleted_at: new Date().toISOString() })
                .or(buildIdFilter(req.params.id))
                .select();
            if (error) throw error;
            if (!data || !data.length) return res.status(404).json({ error: 'Not found' });
            return res.json({ success: true, message: 'Record archived' });
        }
        res.status(503).json({ error: 'Supabase required for soft delete' });
    } catch (error) {
        console.error('Soft delete error:', error);
        res.status(500).json({ error: 'Failed to archive submission' });
    }
});

// POST /api/submissions/:id/restore - restore soft-deleted record
app.post('/api/submissions/:id/restore', authenticateToken, async (req, res) => {
    try {
        if (isSupabaseEnabled()) {
            const { data, error } = await supabaseAdmin
                .from('submissions')
                .update({ deleted_at: null })
                .or(buildIdFilter(req.params.id))
                .select();
            if (error) throw error;
            if (!data || !data.length) return res.status(404).json({ error: 'Not found' });
            return res.json({ success: true, message: 'Record restored' });
        }
        res.status(503).json({ error: 'Supabase required for restore' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to restore submission' });
    }
});

// ==================== NOTES (CRM) ENDPOINTS ====================
// GET /api/submissions/:id/notes - get all notes for a submission
app.get('/api/submissions/:id/notes', authenticateToken, async (req, res) => {
    try {
        if (isSupabaseEnabled()) {
            const { data, error } = await supabaseAdmin
                .from('notes')
                .select('*')
                .eq('submission_id', req.params.id)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return res.json(data || []);
        }
        res.json([]);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch notes' });
    }
});

// POST /api/submissions/:id/notes - add a note to a submission
app.post('/api/submissions/:id/notes', authenticateToken, async (req, res) => {
    try {
        const { note_text } = req.body;
        if (!note_text) return res.status(400).json({ error: 'note_text required' });
        if (isSupabaseEnabled()) {
            const { data, error } = await supabaseAdmin
                .from('notes')
                .insert({
                    submission_id: req.params.id,
                    note_text,
                    created_by: req.user.email || 'admin'
                })
                .select()
                .single();
            if (error) throw error;
            return res.json(data);
        }
        res.status(503).json({ error: 'Supabase required for notes' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add note' });
    }
});

// ==================== FOLLOW-UP ENDPOINTS ====================
// PATCH /api/submissions/:id/follow-up - set follow-up date and note
app.patch('/api/submissions/:id/follow-up', authenticateToken, async (req, res) => {
    try {
        const { follow_up_date, follow_up_note } = req.body;
        if (isSupabaseEnabled()) {
            const { data, error } = await supabaseAdmin
                .from('submissions')
                .update({
                    follow_up_date: follow_up_date || null,
                    follow_up_note: follow_up_note || null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', req.params.id)
                .select();
            if (error) throw error;
            if (!data || !data.length) return res.status(404).json({ error: 'Not found' });
            return res.json(rowToSubmission(data[0]));
        }
        res.status(503).json({ error: 'Supabase required' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to set follow-up' });
    }
});

// PATCH /api/submissions/:id/customer-replied — stop follow-up automation
app.patch('/api/submissions/:id/customer-replied', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        if (isSupabaseEnabled()) {
            await supabaseAdmin.from('submissions')
                .update({ 
                    updated_at: new Date().toISOString(),
                    follow_up_note: 'Customer replied — automation stopped'
                })
                .eq('id', id);
        }
        // Also update in-memory
        const submissions = await readAllSubmissions();
        const sub = submissions.find(s => s.id === id || s.caseId === id);
        if (sub) {
            sub.customerReplied = true;
            console.log(`[FollowUp] Customer replied — automation stopped for ${id}`);
        }
        res.json({ success: true, message: 'Follow-up automation stopped' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to mark reply' });
    }
});

// ── Creator Outreach Tracking ──
let creatorOutreach = []; // In-memory store for creator pipeline

// Load creator emails for matching — embedded for Railway deployment
const creatorEmailMap = new Map();
const CREATOR_EMAIL_DATA = {"denvervibe@gmail.com": {"name": "Denver Vibe", "instagram": "@denvervibe", "followers": 32000, "state": "CO"}, "connor@milehimodern.com": {"name": "Connor Cole", "instagram": "@connordcole", "followers": 6400, "state": "CO"}, "[redacted]@gmail.com": {"name": "Logan Lester", "instagram": "@lololester", "followers": 60000, "state": "TX"}, "angelaguyrealty@gmail.com": {"name": "Angela Guy", "instagram": "@listedbyangela", "followers": 50000, "state": "GA"}, "cbeltre@norluxerealty.com": {"name": "Chianti Beltre", "instagram": "@chianti.therealtor", "followers": 10000, "state": "GA"}, "seanrodriguez@dorseyalston.com": {"name": "Sean Rodriguez", "instagram": "@seanrodriguez_atl", "followers": 10000, "state": "GA"}, "sylvia.nwajei@metrobrokers.com": {"name": "Isioma Nwajei", "instagram": "@isioma.the.realtor", "followers": 8000, "state": "GA"}, "leah@456growth.com": {"name": "Leah Garcia", "instagram": "@leah_txrealtor", "followers": 966000, "state": "TX"}, "nori@norisoldit.com": {"name": "Nori Johnson", "instagram": "@norisoldit", "followers": 363000, "state": "TX"}, "ben@rogershealy.com": {"name": "Ben Wegmann", "instagram": "@benwegmann", "followers": 187000, "state": "TX"}, "armando@outlook.com": {"name": "Armando Nava", "instagram": "@nava.realtor", "followers": 102000, "state": "TX"}, "chris@phyllisbrowning.com": {"name": "Chris Engstrom", "instagram": "@chrisengstromrealtor", "followers": 98000, "state": "TX"}, "[redacted]@ranikatherealtor.com": {"name": "Ranika Prince Gilliam", "instagram": "@ranikatherealtor", "followers": 76000, "state": "TX"}, "david@alamocityrealty.com": {"name": "David Gonzalez", "instagram": "@alamocity_realtor", "followers": 66000, "state": "TX"}, "alex@rentallsa.com": {"name": "Alex Magana", "instagram": "@alexmagana_doesrealestate", "followers": 56000, "state": "TX"}, "[redacted]@shabnamjalili.com": {"name": "Shabnam Jalili", "instagram": "@houstonhousehunter", "followers": 48000, "state": "TX"}, "yesenia@urbandallashomes.com": {"name": "Yesenia Carmolinga", "instagram": "@yeseniacarmolinga", "followers": 40000, "state": "TX"}, "navjot@singhregroup.com": {"name": "Navjot Singh", "instagram": "@navjot.singh.re", "followers": 32000, "state": "TX"}, "andrea@atpropertiestx.com": {"name": "Andrea Reynolds", "instagram": "@andreareynolds_thefitagent", "followers": 29000, "state": "TX"}, "lisa@texashomeopulencegroup.com": {"name": "Lisa Gumbo", "instagram": "@dallasrealtor.lisagumbo", "followers": 24000, "state": "TX"}, "aj@proxypropertymgmt.com": {"name": "A.J. Ramler", "instagram": "@ajramler", "followers": 21000, "state": "TX"}, "keyra@kw.com": {"name": "Keyra Ford", "instagram": "@keyraford", "followers": 20000, "state": "TX"}, "calvin@calvinstrain.com": {"name": "Calvin Strain", "instagram": "@calvinstrainrealestate", "followers": 18000, "state": "TX"}, "porshae@sohourealtygroup.com": {"name": "Porshae Brown", "instagram": "@realtorporshae", "followers": 18000, "state": "TX"}, "hannah@twelveriversrealty.com": {"name": "Hannah Allen", "instagram": "@hannahvnemes", "followers": 16000, "state": "TX"}, "lesley@findmyhomedfw.com": {"name": "Lesley Stegmeier", "instagram": "@lesleystegmeierrealtor", "followers": 16000, "state": "TX"}, "marci@exprealty.com": {"name": "Marci Poticny", "instagram": "@marcipoticnyrealestate", "followers": 14000, "state": "TX"}, "kallie@ritcheyrealty.com": {"name": "Kallie Spencer", "instagram": "@kallieritcheyrealtor", "followers": 12000, "state": "TX"}, "caroline@compass.com": {"name": "Caroline Bean", "instagram": "@carolinebean.compass", "followers": 11000, "state": "TX"}, "john@compass.com": {"name": "John Zimmerman", "instagram": "@jzfortworth", "followers": 11000, "state": "TX"}, "taylor@exprealty.com": {"name": "Taylor Park", "instagram": "@selling_alamo_city", "followers": 11000, "state": "TX"}, "darsh@compass.com": {"name": "Darsh Parikh", "instagram": "@darsh_atx", "followers": 11000, "state": "TX"}, "mark@bigretx.com": {"name": "Mark Anthony Ball", "instagram": "@markanthonyball", "followers": 10000, "state": "TX"}, "carol@compass.com": {"name": "Carol OrtizRodriguez", "instagram": "@caroltherealtor.atx", "followers": 10000, "state": "TX"}, "adrienne@lifeinaustintexas.com": {"name": "Adrienne Gravens", "instagram": "@adriennegravens", "followers": 10000, "state": "TX"}, "mariela@findmyhomedfw.com": {"name": "Mariela Borjon", "instagram": "@dfwrealtormariela", "followers": 10000, "state": "TX"}, "kito@theksrealtygroup.com": {"name": "Kito Smith", "instagram": "@kito_smith_realtor", "followers": 9000, "state": "TX"}, "malina@lptrealty.com": {"name": "Malina Bercher", "instagram": "@movetotexaswithmalina", "followers": 9000, "state": "TX"}, "deedee@compass.com": {"name": "Dee Dee Guggenheim Howes", "instagram": "@deedeehowes.compass", "followers": 9000, "state": "TX"}, "amber@dorseydfwgroup.com": {"name": "Amber Dorsey", "instagram": "@dorsey_sells_dfw", "followers": 9000, "state": "TX"}, "ashley@compass.com": {"name": "Ashley Brinkman", "instagram": "@ihearttheatx", "followers": 9000, "state": "TX"}, "blanca@malouffig.com": {"name": "Blanca Gonzalez", "instagram": "@blancalgonzalezg", "followers": 9000, "state": "TX"}, "ashley@peakhtx.com": {"name": "Ashley Alexander", "instagram": "@ashleyaalexander", "followers": 8000, "state": "TX"}, "sandra@sgrproperties.com": {"name": "Sandra Rangel", "instagram": "@sandrarangel2018", "followers": 8000, "state": "TX"}, "somer@tinsleyrealtygroup.com": {"name": "Somer Tinsley", "instagram": "@somertinsley", "followers": 7000, "state": "TX"}, "sarrah@monumentstar.com": {"name": "Sarrah Hooshmand", "instagram": "@realtorsarrah", "followers": 7000, "state": "TX"}, "misty@theemerygrp.com": {"name": "Misty Rose Galante", "instagram": "@sellsatmistyrose", "followers": 6000, "state": "TX"}, "daira@sanantoniolivinginfo.com": {"name": "Daira Vasquez", "instagram": "@dairavasquezrealtor", "followers": 4000, "state": "TX"}, "jada@fathomrealty.com": {"name": "Jada", "instagram": "@jada_dallas_realtor", "followers": 4000, "state": "TX"}, "aguilarnick1@gmail.com": {"name": "Nick Aguilar", "instagram": "@nick_aguilar_realtor", "followers": null, "state": "TX"}};
Object.entries(CREATOR_EMAIL_DATA).forEach(([email, data]) => {
    creatorEmailMap.set(email.toLowerCase(), data);
});
console.log(`[CreatorTracker] Loaded ${creatorEmailMap.size} creator emails for reply matching`);

// POST /api/inbound-reply — webhook for inbound email replies (SendGrid Inbound Parse)
// Handles BOTH customer lead replies AND creator outreach replies
app.post('/api/inbound-reply', async (req, res) => {
    try {
        const fromEmail = req.body.from || req.body.envelope?.from || '';
        const subject = req.body.subject || '';
        const textBody = req.body.text || '';
        console.log(`[InboundReply] Email received from: ${fromEmail} | Subject: ${subject}`);
        
        const emailClean = fromEmail.replace(/.*</, '').replace(/>.*/, '').trim().toLowerCase();
        
        // ── Store in email viewer ──
        const storedEmail = {
            id: `em-${Date.now()}`,
            from: emailClean,
            fromDisplay: fromEmail.replace(/<.*>/, '').trim() || emailClean,
            subject,
            body: textBody,
            htmlBody: req.body.html || null,
            receivedAt: new Date().toISOString(),
            status: 'new', // new, read, replied, assigned, done
            assignee: null,
            notes: null,
            type: null, // set below: 'creator', 'customer', 'unknown'
            updatedAt: new Date().toISOString()
        };
        emailStore.unshift(storedEmail);
        if (emailStore.length > 100) emailStore.length = 100;
        
        // ── Check 1: Creator reply? ──
        const creator = creatorEmailMap.get(emailClean);
        if (creator) {
            console.log(`[CreatorTracker] 📩 CREATOR REPLY: ${creator.name} (${emailClean})`);
            storedEmail.type = 'creator';
            
            const reply = {
                id: `cr-${Date.now()}`,
                name: creator.name,
                email: emailClean,
                instagram: creator.instagram || null,
                platform: 'email',
                subject: subject.substring(0, 100),
                preview: textBody.substring(0, 200),
                detectedAt: new Date().toISOString(),
                respondedAt: null,
                status: 'new',
                followers: creator.followers || 0,
                state: creator.state || '?'
            };
            creatorOutreach.push(reply);
            
            // Update creator in master file
            creator.replyStatus = 'replied';
            creator.repliedAt = new Date().toISOString();
            creator.replyChannel = 'email';
            
            // Telegram alert — SHORT, high priority
            sendTelegramAlert(`📩 <b>CREATOR REPLY</b>\n<b>From:</b> ${creator.name} (${(creator.followers || 0).toLocaleString()} followers)\n<b>Subject:</b> ${subject.substring(0, 60)}\n⏰ <b>Respond within 30 min — full email in inbox</b>`);
            
            // 30-min warning
            setTimeout(() => {
                const r = creatorOutreach.find(cr => cr.id === reply.id);
                if (r && r.status === 'new') {
                    sendTelegramAlert(`⚠️ <b>CREATOR WAITING — 30 MIN</b>\n\n<b>${creator.name}</b> (${(creator.followers || 0).toLocaleString()} followers)\nReplied 30 min ago. No response yet.\n\n🕐 <b>30 min until BLOCKER</b>`);
                }
            }, 30 * 60 * 1000);
            
            // 1-hour BLOCKER
            setTimeout(() => {
                const r = creatorOutreach.find(cr => cr.id === reply.id);
                if (r && r.status === 'new') {
                    r.status = 'expired';
                    sendTelegramAlert(`🔴 <b>BLOCKER — CREATOR REPLY EXPIRED</b>\n\n<b>${creator.name}</b> (${(creator.followers || 0).toLocaleString()} followers)\nWaited 1 hour with no response.\n\n<b>This creator may be lost.</b>`);
                }
            }, 60 * 60 * 1000);
            
            // Post to Mission Control
            try {
                const fetch = require('node:https');
                const mcData = JSON.stringify({
                    name: creator.name,
                    email: emailClean,
                    instagram: creator.instagram,
                    platform: 'email',
                    subject: subject.substring(0, 100),
                    preview: textBody.substring(0, 200)
                });
                // Fire and forget to Mission Control
                const mcReq = require('https').request('https://mission-control-production-8225.up.railway.app/api/creator-reply', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': mcData.length }
                });
                mcReq.write(mcData);
                mcReq.end();
            } catch (mcErr) { console.error('[CreatorTracker] MC update failed:', mcErr.message); }
            
            res.status(200).send('OK');
            return;
        }
        
        // ── Check 2: Customer lead reply? ──
        if (isSupabaseEnabled() && emailClean) {
            const { data } = await supabaseAdmin.from('submissions')
                .select('id, owner_name, case_id, status, email, phone')
                .ilike('email', emailClean)
                .limit(5);
            
            if (data && data.length > 0) {
                for (const sub of data) {
                    await supabaseAdmin.from('submissions')
                        .update({ 
                            updated_at: new Date().toISOString(),
                            follow_up_note: `Customer replied via email at ${new Date().toISOString()}`
                        })
                        .eq('id', sub.id);
                    console.log(`[InboundReply] Marked ${sub.case_id} (${sub.owner_name}) as replied`);
                    logComm({ event: 'replied', channel: 'email', to: emailClean, caseId: sub.case_id, name: sub.owner_name });
                    storedEmail.type = 'customer';
                }
                
                // ── V2: CLASSIFY REPLY ──
                const replyClass = classifyInboundReply(subject, textBody);
                const classLabel = { A: '📎 SENT NOTICE', B: '❓ QUESTION', C: '✅ READY TO PROCEED', D: '📧 OTHER' }[replyClass] || '📧 OTHER';
                
                // If notice received → mark as HOT priority
                if (replyClass === 'A') {
                    for (const sub of data) {
                        await supabaseAdmin.from('submissions')
                            .update({ 
                                status: 'Notice Received',
                                updated_at: new Date().toISOString(),
                                follow_up_note: `Notice received via email at ${new Date().toISOString()}. PRIORITY ANALYSIS TRIGGERED.`
                            })
                            .eq('id', sub.id);
                    }
                }
                // If ready to proceed → mark as HOT
                if (replyClass === 'C') {
                    for (const sub of data) {
                        await supabaseAdmin.from('submissions')
                            .update({ 
                                updated_at: new Date().toISOString(),
                                follow_up_note: `Client ready to proceed — HOT LEAD. Replied at ${new Date().toISOString()}`
                            })
                            .eq('id', sub.id);
                    }
                }
                
                // Telegram — include classification
                sendTelegramAlert(`📩 <b>CUSTOMER REPLY</b> [${classLabel}]\n<b>From:</b> ${data[0].owner_name} (${data[0].case_id})\n<b>Subject:</b> ${subject.substring(0, 60)}\n<b>Classification:</b> ${classLabel}\n<b>Action:</b> Draft response queued for approval`);
            } else {
                console.log(`[InboundReply] Unknown sender: ${emailClean} | Subject: ${subject}`);
                sendTelegramAlert(`📨 <b>Inbound email</b>\n<b>From:</b> ${emailClean}\n<b>Subject:</b> ${subject.substring(0, 60)}\n<b>Action:</b> Check inbox`);
            }
        }
        
        // ── ALWAYS forward full raw email to Tyler's inbox ──
        try {
            const htmlBody = req.body.html || '';
            const fullBody = htmlBody || textBody;
            await sgMail.send({
                to: 'tyler@overassessed.ai',
                from: { email: process.env.SENDGRID_FROM_EMAIL || 'notifications@overassessed.ai', name: 'OA Inbound' },
                replyTo: { email: emailClean, name: fromEmail.replace(/<.*>/, '').trim() || emailClean },
                subject: `Fwd: ${subject}`,
                html: `<div style="font-family:Arial,sans-serif;max-width:700px;padding:15px;">
                    <div style="background:#f0f0f0;padding:12px;border-radius:6px;margin-bottom:15px;">
                        <b>From:</b> ${fromEmail}<br>
                        <b>Date:</b> ${new Date().toLocaleString('en-US', {timeZone:'America/Chicago'})}<br>
                        <b>Subject:</b> ${subject}
                    </div>
                    <div style="white-space:pre-wrap;">${fullBody}</div>
                </div>`,
                text: `From: ${fromEmail}\nDate: ${new Date().toISOString()}\nSubject: ${subject}\n\n${textBody}`
            });
            console.log(`[InboundReply] Full email forwarded to tyler@overassessed.ai`);
        } catch (fwdErr) {
            console.error(`[InboundReply] Forward failed: ${fwdErr.message}`);
            // Fallback: send via Telegram with more content if forward fails
            sendTelegramAlert(`⚠️ <b>Email forward FAILED</b>\n\n<b>From:</b> ${emailClean}\n<b>Subject:</b> ${subject}\n<b>Body:</b>\n${textBody.substring(0, 500)}\n\n<i>Forward to inbox failed — showing full content here.</i>`);
        }
        
        res.status(200).send('OK');
    } catch (error) {
        console.error('[InboundReply] Error:', error.message);
        res.status(200).send('OK');
    }
});

// ── Email Store (for Mission Control viewer) ──
const emailStore = []; // Last 100 inbound emails

app.get('/api/emails', (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = (page - 1) * limit;
    res.json({
        emails: emailStore.slice(offset, offset + limit),
        total: emailStore.length,
        page,
        pages: Math.ceil(emailStore.length / limit)
    });
});

app.get('/api/emails/:id', (req, res) => {
    const email = emailStore.find(e => e.id === req.params.id);
    if (!email) return res.status(404).json({ error: 'not found' });
    res.json(email);
});

app.patch('/api/emails/:id', (req, res) => {
    const email = emailStore.find(e => e.id === req.params.id);
    if (!email) return res.status(404).json({ error: 'not found' });
    if (req.body.status) email.status = req.body.status; // new, read, replied, assigned, done
    if (req.body.assignee) email.assignee = req.body.assignee;
    if (req.body.notes) email.notes = req.body.notes;
    email.updatedAt = new Date().toISOString();
    res.json({ success: true, email });
});

// GET /api/creator-replies — list creator reply pipeline
app.get('/api/creator-replies', (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const todayReplies = creatorOutreach.filter(r => r.detectedAt.slice(0, 10) === today);
    const unresponded = creatorOutreach.filter(r => r.status === 'new');
    const expired = creatorOutreach.filter(r => {
        if (r.status !== 'new') return false;
        const age = Date.now() - new Date(r.detectedAt).getTime();
        return age > 60 * 60 * 1000; // 1 hour
    });
    
    // Mark expired
    expired.forEach(r => { r.status = 'expired'; });
    
    res.json({
        today: todayReplies,
        unresponded,
        expired,
        total: creatorOutreach.length,
        stats: {
            totalContacted: creatorEmailMap.size,
            totalReplied: creatorOutreach.length,
            replyRate: creatorEmailMap.size > 0 ? `${((creatorOutreach.length / creatorEmailMap.size) * 100).toFixed(1)}%` : '0%'
        }
    });
});

// POST /api/creator-reply — manual log (from cron or MC)
app.post('/api/creator-reply-log', (req, res) => {
    const { name, email, instagram, platform, subject, preview } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    
    const reply = {
        id: `cr-${Date.now()}`,
        name, email, instagram,
        platform: platform || 'email',
        subject, preview,
        detectedAt: new Date().toISOString(),
        respondedAt: null,
        status: 'new'
    };
    creatorOutreach.push(reply);
    
    sendTelegramAlert(`📩 <b>CREATOR REPLY</b> (manual)\n\n<b>Name:</b> ${name}\n<b>Platform:</b> ${platform || 'email'}\n\n⏰ <b>1-HOUR SLA</b>`);
    
    res.json({ success: true, reply });
});

// PATCH /api/creator-reply/:id — mark responded
app.patch('/api/creator-reply/:id', (req, res) => {
    const reply = creatorOutreach.find(r => r.id === req.params.id);
    if (!reply) return res.status(404).json({ error: 'not found' });
    reply.status = 'responded';
    reply.respondedAt = new Date().toISOString();
    res.json({ success: true, reply });
});

app.post('/api/notify', authenticateToken, async (req, res) => {
    try {
        const { submissionId } = req.body;
        const sub = await findSubmission(submissionId);
        if (!sub) return res.status(404).json({ error: 'Submission not found' });

        const { sms, html } = buildNotificationContent(sub);
        await sendNotificationSMS(sms);
        await sendNotificationEmail('OverAssessed - Re-notification: ' + sub.ownerName, html);
        res.json({ success: true, message: 'Notifications sent' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to send notifications' });
    }
});

app.get('/api/stats', authenticateToken, async (req, res) => {
    try {
        const submissions = await readAllSubmissions();
        const total = submissions.length;
        // Use ACTUAL DB stages only
        const activeStages = ['New', 'Contacted', 'Analysis Complete', 'Form Signed', 'Filing Prepared', 'Submitted', 'Needs Data', 'Hearing Scheduled'];
        const active = submissions.filter(s => activeStages.includes(s.status)).length;
        // Signed = fee_agreement_signed OR stage in (Form Signed, Filing Prepared)
        const signed = submissions.filter(s => s.feeAgreementSigned || s.fee_agreement_signed || ['Form Signed', 'Filing Prepared'].includes(s.status)).length;
        const filed = submissions.filter(s => ['Submitted', 'Filing Prepared'].includes(s.status)).length;
        const won = submissions.filter(s => s.status === 'Won').length;
        const lost = submissions.filter(s => s.status === 'Lost').length;
        const decided = won + lost;
        const winRate = decided > 0 ? Math.round((won / decided) * 100) : 0;
        // Use estimated_savings (correct field name from Supabase)
        const totalSavings = submissions.reduce((sum, s) => sum + (parseFloat(s.estimatedSavings) || parseFloat(s.estimated_savings) || 0), 0);

        res.json({ total, active, signed, filed, won, lost, winRate, totalSavings });
    } catch (error) {
        res.status(500).json({ error: 'Failed to compute stats' });
    }
});

// ==================== SERVE PAGES ====================
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'admin.html'));
});

app.get('/portal', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'portal.html'));
});

// Portal deep link with UUID token - look up case ID and redirect to sign page
app.get('/portal/:token', async (req, res) => {
    try {
        const { data } = await supabase.from('submissions').select('case_id').eq('id', req.params.token).single();
        if (data && data.case_id) {
            return res.redirect(`/sign/${data.case_id}`);
        }
    } catch (e) {
        console.error('[Portal Token] Lookup failed:', e.message);
    }
    // Fallback to portal login page
    res.redirect('/portal');
});

app.get('/sign/:id', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'sign.html'));
});

// Landing pages
app.get('/lp/san-antonio', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'san-antonio.html'));
});

app.get('/lp/texas', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'texas.html'));
});

app.get('/lp/commercial', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'commercial.html'));
});

app.get('/lp/georgia', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'georgia.html'));
});

// PPC Landing Pages
app.get('/ppc/property-tax-protest', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'ppc-property-tax-protest.html'));
});
app.get('/ppc/bexar', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'ppc-bexar.html'));
});
app.get('/ppc/harris', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'ppc-harris.html'));
});
app.get('/ppc/dallas', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'ppc-dallas.html'));
});
app.get('/ppc/tarrant', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'ppc-tarrant.html'));
});

// Texas county landing pages (2026 SEO campaign)
app.get('/lp/bexar-county', (req, res) => {
    res.sendFile(path.join(__dirname, '../', 'lp', 'bexar-county.html'));
});
app.get('/lp/comal-county', (req, res) => {
    res.sendFile(path.join(__dirname, '../', 'lp', 'comal-county.html'));
});
app.get('/lp/guadalupe-county', (req, res) => {
    res.sendFile(path.join(__dirname, '../', 'lp', 'guadalupe-county.html'));
});
app.get('/lp/hays-county', (req, res) => {
    res.sendFile(path.join(__dirname, '../', 'lp', 'hays-county.html'));
});

// Missing county routes (fixed 2026-03-03)
app.get('/collin-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'collin-county.html'));
});
app.get('/denton-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'denton-county.html'));
});
app.get('/fort-bend-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'fort-bend-county.html'));
});
app.get('/williamson-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'williamson-county.html'));
});
app.get('/montgomery-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'montgomery-county.html'));
});
app.get('/el-paso-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'el-paso-county.html'));
});
app.get('/hidalgo-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'hidalgo-county.html'));
});
app.get('/guadalupe-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'guadalupe-county.html'));
});
app.get('/comal-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'comal-county.html'));
});
app.get('/hays-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'hays-county.html'));
});
app.get('/lp/travis-county', (req, res) => {
    res.sendFile(path.join(__dirname, '../', 'lp', 'travis-county.html'));
});
app.get('/lp/williamson-county', (req, res) => {
    res.sendFile(path.join(__dirname, '../', 'lp', 'williamson-county.html'));
});
app.get('/lp/dallas-county', (req, res) => {
    res.sendFile(path.join(__dirname, '../', 'lp', 'dallas-county.html'));
});
app.get('/lp/harris-county', (req, res) => {
    res.sendFile(path.join(__dirname, '../', 'lp', 'harris-county.html'));
});
app.get('/lp/tarrant-county', (req, res) => {
    res.sendFile(path.join(__dirname, '../', 'lp', 'tarrant-county.html'));
});
app.get('/lp/collin-county', (req, res) => {
    res.sendFile(path.join(__dirname, '../', 'lp', 'collin-county.html'));
});
app.get('/lp/denton-county', (req, res) => {
    res.sendFile(path.join(__dirname, '../', 'lp', 'denton-county.html'));
});
app.get('/lp/fort-bend-county', (req, res) => {
    res.sendFile(path.join(__dirname, '../', 'lp', 'fort-bend-county.html'));
});
app.get('/lp/montgomery-county', (req, res) => {
    res.sendFile(path.join(__dirname, '../', 'lp', 'montgomery-county.html'));
});
app.get('/lp/el-paso-county', (req, res) => {
    res.sendFile(path.join(__dirname, '../', 'lp', 'el-paso-county.html'));
});
app.get('/lp/hidalgo-county', (req, res) => {
    res.sendFile(path.join(__dirname, '../', 'lp', 'hidalgo-county.html'));
});

// County-specific landing pages

// PPC Landing Pages (Google Ads / paid traffic)
app.get('/ppc/property-tax-protest', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'ppc-property-tax-protest.html'));
});
app.get('/ppc/bexar', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'ppc-bexar.html'));
});
app.get('/ppc/harris', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'ppc-harris.html'));
});
app.get('/ppc/dallas', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'ppc-dallas.html'));
});
app.get('/ppc/tarrant', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'ppc-tarrant.html'));
});
app.get('/bexar-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'bexar-county.html'));
});
app.get('/harris-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'harris-county.html'));
});
app.get('/travis-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'travis-county.html'));
});
app.get('/dallas-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'dallas-county.html'));
});
app.get('/tarrant-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'tarrant-county.html'));
});

// [REDIRECT-OVERRIDE] app.get('/georgia', (req, res) => {
// [REDIRECT-OVERRIDE]     res.sendFile(path.join(__dirname, '..', 'lp', 'georgia.html'));
// [REDIRECT-OVERRIDE] });

// Ohio routes commented out - deadline passed, pulling out of state (2026-03-31)
// app.get('/ohio', (req, res) => {
//     res.sendFile(path.join(__dirname, '..', 'lp', 'ohio.html'));
// });
// app.get('/lp/ohio', (req, res) => {
//     res.sendFile(path.join(__dirname, '..', 'lp', 'ohio.html'));
// });

// [SIMPLE-REDIRECT] app.get('/arizona', (req, res) => {
//     res.sendFile(path.join(__dirname, '..', 'lp', 'arizona.html'));
// });

// [SIMPLE-REDIRECT] app.get('/colorado', (req, res) => {
//     res.sendFile(path.join(__dirname, '..', 'lp', 'colorado.html'));
// });

app.get('/commercial', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'commercial.html'));
});

app.get('/texas', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'texas.html'));
});

// Washington state + county pages
// [SIMPLE-REDIRECT] app.get('/washington', (req, res) => {
//     res.sendFile(path.join(__dirname, '..', 'lp', 'washington.html'));
// });
app.get('/king-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'king-county.html'));
});
app.get('/pierce-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'pierce-county.html'));
});
app.get('/snohomish-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'snohomish-county.html'));
});
app.get('/clark-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'clark-county.html'));
});
// Also serve under /lp/ prefix
app.get('/lp/washington', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'washington.html'));
});
app.get('/lp/king-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'king-county.html'));
});
app.get('/lp/pierce-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'pierce-county.html'));
});
app.get('/lp/snohomish-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'snohomish-county.html'));
});
app.get('/lp/clark-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'clark-county.html'));
});

// Colorado landing pages
// [SIMPLE-REDIRECT] app.get('/colorado', (req, res) => {
//     res.sendFile(path.join(__dirname, '..', 'lp', 'colorado.html'));
// });
app.get('/lp/colorado', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'colorado.html'));
});
app.get('/lp/pitkin-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'pitkin-county.html'));
});
app.get('/pitkin-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'pitkin-county.html'));
});
app.get('/lp/eagle-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'eagle-county.html'));
});
app.get('/eagle-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'eagle-county.html'));
});
app.get('/lp/summit-county-co', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'summit-county-co.html'));
});
app.get('/summit-county-co', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'summit-county-co.html'));
});
app.get('/lp/routt-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'routt-county.html'));
});
app.get('/routt-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'routt-county.html'));
});
app.get('/lp/gunnison-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'gunnison-county.html'));
});
app.get('/gunnison-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'gunnison-county.html'));
});
app.get('/lp/san-miguel-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'san-miguel-county.html'));
});
app.get('/san-miguel-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'san-miguel-county.html'));
});
app.get('/lp/grand-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'grand-county.html'));
});
app.get('/grand-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'grand-county.html'));
});
app.get('/lp/la-plata-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'la-plata-county.html'));
});
app.get('/la-plata-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'la-plata-county.html'));
});

// Arizona landing pages
// [SIMPLE-REDIRECT] app.get('/arizona', (req, res) => {
//     res.sendFile(path.join(__dirname, '..', 'lp', 'arizona.html'));
// });
app.get('/lp/arizona', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'arizona.html'));
});
app.get('/lp/maricopa-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'maricopa-county.html'));
});
app.get('/maricopa-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'maricopa-county.html'));
});
app.get('/lp/pima-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'pima-county.html'));
});
app.get('/pima-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'pima-county.html'));
});
app.get('/lp/pinal-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'pinal-county.html'));
});
app.get('/pinal-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'pinal-county.html'));
});
app.get('/lp/coconino-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'coconino-county.html'));
});
app.get('/coconino-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'coconino-county.html'));
});
app.get('/lp/yavapai-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'yavapai-county.html'));
});
app.get('/yavapai-county', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'yavapai-county.html'));
});

app.get('/san-antonio', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'san-antonio.html'));
});

app.get('/pre-register', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'pre-register.html'));
});

app.get('/pre-season', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'pre-season.html'));
});

app.get('/developers', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'developers.html'));
});

// ─── Tracking Redirects (Creator Outreach + MilePilot) ─────────────────────
const trackingLog = path.join(__dirname, '..', 'data', 'tracking-clicks.json');
function logClick(source, req) {
    const entry = { source, ts: new Date().toISOString(), ip: req.ip, ua: (req.headers['user-agent']||'').substring(0,120), ref: req.query.ref || '' };
    try {
        const clicks = fs.existsSync(trackingLog) ? JSON.parse(fs.readFileSync(trackingLog,'utf8')) : [];
        clicks.push(entry);
        fs.writeFileSync(trackingLog, JSON.stringify(clicks, null, 2));
    } catch(e) { console.error('[Tracking]', e.message); }
}
app.get('/e1', (req, res) => { logClick('email', req); res.redirect('https://overassessed.ai/?utm_source=email&utm_medium=creator&utm_campaign=outreach'); });
app.get('/r1', (req, res) => { logClick('reddit', req); res.redirect('https://milepilot.app/?utm_source=reddit&utm_medium=social&utm_campaign=launch'); });
app.get('/fb1', (req, res) => { logClick('facebook', req); res.redirect('https://milepilot.app/?utm_source=facebook&utm_medium=social&utm_campaign=launch'); });
app.get('/mp', (req, res) => { logClick('milepilot-general', req); res.redirect('https://testflight.apple.com/join/4r14t4G6'); });
// ────────────────────────────────────────────────────────────────────────────

app.get('/privacy', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'privacy.html'));
});

app.get('/terms', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'terms.html'));
});

app.get('/calculator', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'calculator.html'));
});

app.get('/sitemap.xml', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'sitemap.xml'));
});

app.get('/robots.txt', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'robots.txt'));
});

app.get('/llms.txt', (req, res) => {
    res.type('text/plain').sendFile(path.join(__dirname, '..', 'llms.txt'));
});

app.get('/llms-full.txt', (req, res) => {
    res.type('text/plain').sendFile(path.join(__dirname, '..', 'llms-full.txt'));
});

app.get('/faq', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'faq.html'));
});

app.get('/exemptions', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'exemptions.html'));
});

app.get('/referrals', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'referrals.html'));
});

// Blog routes - serve static HTML files from cwd (Railway-safe)
const blogBasePath = path.join(process.cwd(), 'blog');
app.get('/blog', (req, res) => {
    const fs = require('fs');
    const blogIndex = path.join(blogBasePath, 'index.html');
    if (fs.existsSync(blogIndex)) {
        return res.sendFile(blogIndex);
    }
    console.log(`[blog] index not found at ${blogIndex}`);
    res.status(404).sendFile(path.join(process.cwd(), 'index.html'));
});
app.get('/blog/', (req, res) => {
    const fs = require('fs');
    const blogIndex = path.join(blogBasePath, 'index.html');
    if (fs.existsSync(blogIndex)) {
        return res.sendFile(blogIndex);
    }
    res.status(404).sendFile(path.join(process.cwd(), 'index.html'));
});
app.get('/blog/:slug', (req, res) => {
    const fs = require('fs');
    const slug = req.params.slug;
    const tryPaths = [
        path.join(blogBasePath, slug),
        path.join(blogBasePath, `${slug}.html`),
    ];
    console.log(`[blog] Requested: ${slug}, blogBase: ${blogBasePath}, exists: ${fs.existsSync(blogBasePath)}`);
    for (const tp of tryPaths) {
        if (fs.existsSync(tp)) {
            console.log(`[blog] Serving: ${tp}`);
            return res.sendFile(tp);
        }
    }
    console.log(`[blog] Not found. Tried: ${tryPaths.join(', ')}`);
    res.status(404).sendFile(path.join(process.cwd(), 'index.html'));
});

// TikTok domain verification
app.get('/tiktokKIXW8kcCOw9dYhRPnYsy10Xqz1VGsZUD.txt', (req, res) => {
    res.type('text/plain').send('tiktokKIXW8kcCOw9dYhRPnYsy10Xqz1VGsZUD');
});

// ══════════════════════════════════════════════════════════════
// 🔀 REDIRECT: Route state short-codes to /simple funnel
// Added 2026-04-03 — all Meta ad traffic → simplified 2-field form
// This replaces the 31-field SPA with the high-converting /simple page
// ══════════════════════════════════════════════════════════════
const STATE_REDIRECTS = { '/tx': 'TX', '/ga': 'GA', '/wa': 'WA', '/az': 'AZ', '/co': 'CO', '/oh': 'OH',
    '/georgia': 'GA', '/arizona': 'AZ', '/colorado': 'CO', '/washington': 'WA', '/ohio': 'OH' };
Object.entries(STATE_REDIRECTS).forEach(([path, state]) => {
    app.get(path, (req, res) => {
        const query = req.query;
        const params = new URLSearchParams({ state, ...query });
        console.log(`[REDIRECT] ${path} → /simple?${params}`);
        res.redirect(302, `/simple?${params}`);
    });
});

// Catch-all: serve frontend (skip /admin/* and /api/* routes)
app.get('{*path}', (req, res, next) => {
    if (req.path.startsWith('/admin/') || req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start
async function startServer() {
    await initializeDataFiles();

    // Download county data files if not present (Railway deployment)
    try {
        const { downloadAll } = require('./scripts/download-data');
        if (typeof downloadAll === 'function') await downloadAll();
    } catch (e) {
        console.log('[DataDownloader] Skipped:', e.message);
    }

    // Load Tarrant County real property data (async, non-blocking)
    tarrantData.loadData().then(loaded => {
        if (loaded) {
            const stats = tarrantData.getStats();
            console.log(`🏠 Tarrant CAD: ${stats.totalRecords.toLocaleString()} parcels loaded (${stats.memoryMB}MB)`);
        } else {
            console.log('⚠️  Tarrant CAD data not available - using synthetic comps for Tarrant County');
        }
    }).catch(err => {
        console.error('❌ Tarrant CAD load error:', err.message);
    });

    // Load all other county bulk data (Bexar, Harris, etc.)
    const { initAllCounties } = require('./services/local-parcel-data');
    initAllCounties().then(() => {
        console.log('🏠 All county bulk data loaded');
    }).catch(err => {
        console.error('❌ County data load error:', err.message);
    });
    
// ===== AI-POWERED PHONE ANSWERING SERVICE =====
// Conversation state: CallSid -> { messages: [], callerInfo: {}, startTime: Date }
const aiCallState = new Map();

// Clean up stale conversations every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [sid, state] of aiCallState) {
        if (now - state.startTime > 30 * 60 * 1000) {
            aiCallState.delete(sid);
        }
    }
}, 5 * 60 * 1000);

// Gemini Flash API helper
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const AI_SYSTEM_PROMPT = `You are Sarah, the friendly and knowledgeable phone receptionist at OverAssessed. You sound natural, warm, confident, and helpful - like a real person who genuinely cares, not a robot reading a script.

ABOUT OVERASSESSED:
- Property tax protest experts serving all of Texas AND Georgia
- How it works: Give us your property address → we run a free analysis → if you're overpaying, we file the protest and handle everything → you save money
- Pricing: 25% of tax savings across all states (TX, GA, WA, AZ, CO). Just a $79 initiation fee to get started, which gets credited toward your contingency fee.
- Timeline: TX protest season is mid-April through August. TX deadline is May 15. GA deadline is 45 days after assessment notice (April-June).
- Georgia special: If you win an appeal, your value is FROZEN for 3 years. That's 3 years of guaranteed savings from one appeal.
- Homestead exemptions: We file those too, included free with our service
- Website: overassessed.ai (Georgia: overassessed.ai/georgia)
- Owner: Tyler Worthey personally reviews every case
- Phone: (888) 282-9165

LEAD CAPTURE (YOUR #1 JOB):
Your primary goal is to collect the caller's information so we can run their free analysis. You need:
1. Their NAME (first and last)
2. Their PROPERTY ADDRESS (full street address, city, state)
3. Their PHONE NUMBER or EMAIL for follow-up
Ask for these ONE AT A TIME. Start with "Can I get your name?" then address, then contact info.
Once you have all three, say: "Perfect! I've got everything I need. We'll run your free analysis and Tyler will personally follow up with your results within 24 hours."

PHONE CALL RULES (CRITICAL):
- Keep responses to 1-3 SHORT sentences max. Phone callers hate long responses.
- Sound natural. Use contractions freely - "we'll", "you're", "that's", "don't".
- When someone gives info, REPEAT IT BACK: "Got it, so that's John Smith at 123 Main Street in San Antonio, right?"
- If speech sounds garbled: "Sorry, I didn't quite catch that. Could you repeat that for me?"
- If they ask something you don't know: "That's a great question. Tyler can go into more detail on that when he follows up with your analysis. Want me to get your info so he can reach out?"
- ALWAYS steer the conversation toward collecting their info
- Your name is Sarah. You're the front office assistant.
- NEVER use markdown, bullet points, asterisks, numbered lists, or any formatting
- Be conversational and warm. Laugh naturally if something's funny. Be human.
- If they seem hesitant: "I totally understand. There's zero risk - the analysis is completely free and there's no obligation. We just need your address to check if you're overpaying."
- End every interaction trying to collect their info if you haven't already`;

async function callClaude(messages) {
    if (!ANTHROPIC_API_KEY) {
        console.error('[AI Phone] No ANTHROPIC_API_KEY configured');
        return null;
    }
    
    // Convert to Anthropic format
    const anthropicMessages = messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
    }));
    
    try {
        const resp = await fetch(ANTHROPIC_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-5-haiku-20241022',
                max_tokens: 250,
                system: AI_SYSTEM_PROMPT,
                messages: anthropicMessages
            })
        });
        
        if (!resp.ok) {
            const errText = await resp.text();
            console.error('[AI Phone] Claude error:', resp.status, errText);
            return null;
        }
        
        const data = await resp.json();
        return data.content?.[0]?.text || null;
    } catch (err) {
        console.error('[AI Phone] Claude fetch error:', err.message);
        return null;
    }
}


// Check if currently business hours (M-F 8AM-6PM CT)
function isBusinessHours() {
    const now = new Date();
    const ct = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const day = ct.getDay(); // 0=Sun, 6=Sat
    const hour = ct.getHours();
    return day >= 1 && day <= 5 && hour >= 8 && hour < 18;
}

// Extract caller info from conversation
function extractCallerInfo(messages) {
    const info = { name: null, address: null, phone: null, email: null };
    const fullText = messages.map(m => m.content).join(' ');
    
    // Email
    const emailMatch = fullText.match(/[\w.-]+@[\w.-]+\.\w{2,}/);
    if (emailMatch) info.email = emailMatch[0];
    
    return info;
}

// 1. Inbound call - AI greeting + first gather
app.post('/twiml/voice', (req, res) => {
    const callSid = req.body?.CallSid || 'unknown';
    const callerNumber = req.body?.From || 'Unknown';
    
    console.log(`📞 [AI Phone] Incoming call from ${callerNumber} (${callSid})`);
    
    // Initialize conversation state
    aiCallState.set(callSid, {
        messages: [],
        callerInfo: { phone: callerNumber },
        startTime: Date.now(),
        callerNumber
    });
    
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech dtmf" timeout="8" speechTimeout="auto" speechModel="phone_call" enhanced="true" action="/twiml/ai-respond" method="POST">
        <Say voice="Polly.Joanna">Thank you for calling OverAssessed, property tax protest experts. My name is Sarah! How can I help you today?</Say>
    </Gather>
    <Say voice="Polly.Joanna">I didn't catch that. Let me transfer you to Tyler.</Say>
    <Redirect>/twiml/ai-transfer</Redirect>
</Response>`);
    
    // Store the greeting as assistant message
    const state = aiCallState.get(callSid);
    if (state) {
        state.messages.push({
            role: 'assistant',
            content: 'Thank you for calling OverAssessed, Texas property tax experts. How can I help you today?'
        });
    }
});

// 2. AI respond - process speech, get AI response, gather again
app.post('/twiml/ai-respond', async (req, res) => {
    const callSid = req.body?.CallSid || 'unknown';
    const speechResult = req.body?.SpeechResult || '';
    const callerNumber = req.body?.From || 'Unknown';
    
    console.log(`🗣️ [AI Phone] Caller said (${callSid}): "${speechResult}"`);
    
    // Get or create conversation state
    let state = aiCallState.get(callSid);
    if (!state) {
        state = {
            messages: [],
            callerInfo: { phone: callerNumber },
            startTime: Date.now(),
            callerNumber
        };
        aiCallState.set(callSid, state);
    }
    
    // Check if caller wants to talk to someone
    const wantsTransfer = /transfer|speak|talk|person|human|representative|agent|tyler|operator/i.test(speechResult);
    const wantsEnd = /goodbye|bye|that's all|that's it|no thanks|nothing else|hang up/i.test(speechResult);
    
    // Add caller's speech to conversation
    state.messages.push({ role: 'user', content: speechResult });
    
    if (wantsEnd) {
        // Caller wants to end the call
        res.type('text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna">Thank you for calling OverAssessed. Have a wonderful day! Goodbye.</Say>
    <Hangup/>
</Response>`);
        // Send summary
        sendCallSummary(callSid, state).catch(err => console.error('[AI Phone] Summary error:', err.message));
        return;
    }
    
    if (wantsTransfer) {
        if (isBusinessHours()) {
            res.type('text/xml');
            res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna">Of course! Let me transfer you to Tyler right now. One moment please.</Say>
    <Dial timeout="20" callerId="+18882829165" action="/twiml/ai-transfer-status">
        <Number>+12105598725</Number>
    </Dial>
</Response>`);
            return;
        } else {
            // Outside business hours - tell them Tyler will call back
            state.messages.push({
                role: 'assistant',
                content: "I'd be happy to have Tyler call you back. Our business hours are Monday through Friday, 8 AM to 6 PM Central Time. Tyler will call you back within one business hour once we're open. Can I help you with anything else in the meantime?"
            });
            res.type('text/xml');
            res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech dtmf" timeout="8" speechTimeout="auto" speechModel="phone_call" enhanced="true" action="/twiml/ai-respond" method="POST">
        <Say voice="Polly.Joanna">I'd be happy to have Tyler call you back. Our business hours are Monday through Friday, 8 AM to 6 PM Central Time. Tyler will call you back within one business hour once we're open. Can I help you with anything else in the meantime?</Say>
    </Gather>
    <Say voice="Polly.Joanna">Thank you for calling OverAssessed. Goodbye!</Say>
    <Hangup/>
</Response>`);
            sendCallSummary(callSid, state).catch(err => console.error('[AI Phone] Summary error:', err.message));
            return;
        }
    }
    
    // Get AI response
    const aiResponse = await callClaude(state.messages);
    
    if (!aiResponse) {
        // Fallback if AI fails
        res.type('text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna">I apologize, I'm having some technical difficulty. Let me transfer you to Tyler.</Say>
    <Redirect>/twiml/ai-transfer</Redirect>
</Response>`);
        return;
    }
    
    // Clean up response for TwiML (escape XML special chars)
    const safeResponse = aiResponse
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/\*/g, '')
        .replace(/#{1,}/g, '')
        .trim();
    
    state.messages.push({ role: 'assistant', content: aiResponse });
    
    console.log(`🤖 [AI Phone] AI says (${callSid}): "${aiResponse.substring(0, 100)}..."`);
    
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech dtmf" timeout="8" speechTimeout="auto" speechModel="phone_call" enhanced="true" action="/twiml/ai-respond" method="POST">
        <Say voice="Polly.Joanna">${safeResponse}</Say>
    </Gather>
    <Say voice="Polly.Joanna">I didn't catch a response. Thank you for calling OverAssessed. Goodbye!</Say>
    <Hangup/>
</Response>`);
});

// 3. Transfer to Tyler
app.post('/twiml/ai-transfer', (req, res) => {
    const callSid = req.body?.CallSid || 'unknown';
    
    if (isBusinessHours()) {
        res.type('text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna">Let me transfer you to Tyler. One moment please.</Say>
    <Dial timeout="20" callerId="+18882829165" action="/twiml/ai-transfer-status">
        <Number>+12105598725</Number>
    </Dial>
</Response>`);
    } else {
        res.type('text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna">We're currently outside business hours. Our hours are Monday through Friday, 8 AM to 6 PM Central Time. Tyler will call you back within one business hour when we reopen. Thank you for calling OverAssessed!</Say>
    <Hangup/>
</Response>`);
        const state = aiCallState.get(callSid);
        if (state) {
            sendCallSummary(callSid, state).catch(err => console.error('[AI Phone] Summary error:', err.message));
        }
    }
});

// 4. Transfer status callback
app.post('/twiml/ai-transfer-status', (req, res) => {
    const dialStatus = req.body?.DialCallStatus || 'no-answer';
    const callSid = req.body?.CallSid || 'unknown';
    
    res.type('text/xml');
    if (dialStatus === 'completed') {
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Hangup/></Response>`);
    } else {
        // Tyler didn't answer - voicemail fallback
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna">Tyler is unavailable right now. Please leave a message after the beep and he'll call you back within one business hour.</Say>
    <Record maxLength="120" transcribe="true" transcribeCallback="/twiml/transcription" playBeep="true" action="/twiml/recording-done" />
    <Say voice="Polly.Joanna">We didn't receive a recording. Thank you for calling. Goodbye.</Say>
</Response>`);
    }
    
    const state = aiCallState.get(callSid);
    if (state) {
        sendCallSummary(callSid, state).catch(err => console.error('[AI Phone] Summary error:', err.message));
    }
});

// 5. Call complete - send summary notifications
app.post('/twiml/ai-complete', (req, res) => {
    const callSid = req.body?.CallSid || 'unknown';
    const state = aiCallState.get(callSid);
    
    if (state) {
        sendCallSummary(callSid, state).catch(err => console.error('[AI Phone] Summary error:', err.message));
    }
    
    res.sendStatus(200);
});

// Send call summary via SMS + Email
async function sendCallSummary(callSid, state) {
    if (!state || !state.messages.length) return;
    
    const callerNumber = state.callerNumber || 'Unknown';
    const callerInfo = extractCallerInfo(state.messages);
    const callTime = new Date(state.startTime).toLocaleString('en-US', { timeZone: 'America/Chicago' });
    
    // Build conversation transcript
    const transcript = state.messages.map(m => {
        const speaker = m.role === 'assistant' ? 'AI' : 'Caller';
        return `${speaker}: ${m.content}`;
    }).join('\n');
    
    // Parse caller info from conversation text
    const fullText = state.messages.filter(m => m.role === 'user').map(m => m.content).join(' ');
    
    // SMS to Tyler - short summary
    const smsLines = [`📞 AI Call Summary`, `From: ${callerNumber}`, `Time: ${callTime}`];
    if (callerInfo.name) smsLines.push(`Name: ${callerInfo.name}`);
    if (callerInfo.address) smsLines.push(`Property: ${callerInfo.address}`);
    if (callerInfo.email) smsLines.push(`Email: ${callerInfo.email}`);
    smsLines.push(`Turns: ${state.messages.filter(m => m.role === 'user').length}`);
    // Include first caller message as context
    const firstUserMsg = state.messages.find(m => m.role === 'user');
    if (firstUserMsg) smsLines.push(`Topic: ${firstUserMsg.content.substring(0, 80)}`);
    
    if (twilioClient) {
        try {
            await twilioClient.messages.create({
                body: smsLines.join('\n'),
                from: process.env.TWILIO_SMS_NUMBER || '+18309537253',
                to: '+12105598725'
            });
            console.log(`📱 [AI Phone] SMS summary sent to Tyler for ${callSid}`);
        } catch (err) {
            console.error('[AI Phone] SMS error:', err.message);
        }
    }
    
    // Email to Tyler - full transcript
    if (process.env.SENDGRID_API_KEY) {
        try {
            const transcriptHtml = state.messages.map(m => {
                const speaker = m.role === 'assistant' ? '🤖 AI' : '👤 Caller';
                const color = m.role === 'assistant' ? '#2563eb' : '#16a34a';
                return `<p><strong style="color:${color}">${speaker}:</strong> ${m.content}</p>`;
            }).join('');
            
            await sgMail.send({
                to: 'tyler@overassessed.ai',
                from: process.env.SENDGRID_FROM_EMAIL || 'notifications@overassessed.ai',
                subject: `📞 AI Call from ${callerNumber} - ${callTime}`,
                html: `
                    <h2>AI Phone Call Summary</h2>
                    <table style="border-collapse:collapse;margin-bottom:16px;">
                        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Caller:</td><td>${callerNumber}</td></tr>
                        <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Time:</td><td>${callTime}</td></tr>
                        ${callerInfo.name ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Name:</td><td>${callerInfo.name}</td></tr>` : ''}
                        ${callerInfo.address ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Property:</td><td>${callerInfo.address}</td></tr>` : ''}
                        ${callerInfo.email ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Email:</td><td>${callerInfo.email}</td></tr>` : ''}
                    </table>
                    <h3>Full Conversation</h3>
                    ${transcriptHtml}
                    <hr>
                    <p style="color:#888;font-size:12px;">OverAssessed Phone - (888) 282-9165</p>
                `
            });
            console.log(`📧 [AI Phone] Email summary sent for ${callSid}`);
        } catch (err) {
            console.error('[AI Phone] Email error:', err.message);
        }
    }
    
    // Clean up state
    aiCallState.delete(callSid);
}

// ===== VOICEMAIL FALLBACK ROUTES (kept for transfer fallback) =====
// After recording is done
app.post('/twiml/recording-done', (req, res) => {
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna">Thank you. Tyler will get back to you soon. Goodbye.</Say>
    <Hangup/>
</Response>`);
    
    const recordingUrl = req.body?.RecordingUrl;
    const callerNumber = req.body?.From || 'Unknown';
    if (recordingUrl) {
        sendVoicemailEmail(callerNumber, recordingUrl, null);
    }
});

// Transcription callback
app.post('/twiml/transcription', (req, res) => {
    const transcription = req.body?.TranscriptionText || '';
    const recordingUrl = req.body?.RecordingUrl || '';
    const callerNumber = req.body?.From || 'Unknown';
    
    if (transcription) {
        sendVoicemailEmail(callerNumber, recordingUrl, transcription);
    }
    res.sendStatus(200);
});

// Email voicemail to Tyler
async function sendVoicemailEmail(from, recordingUrl, transcription) {
    if (!process.env.SENDGRID_API_KEY) return;
    
    const subject = transcription 
        ? `📞 OA Voicemail from ${from} (transcribed)`
        : `📞 OA Voicemail from ${from} (new recording)`;
    
    const html = `
        <h2>New Voicemail - OverAssessed</h2>
        <p><strong>From:</strong> ${from}</p>
        <p><strong>Time:</strong> ${new Date().toLocaleString('en-US', {timeZone: 'America/Chicago'})}</p>
        ${transcription ? `<p><strong>Transcription:</strong> ${transcription}</p>` : ''}
        ${recordingUrl ? `<p><strong>Listen:</strong> <a href="${recordingUrl}">${recordingUrl}</a></p>` : ''}
        <hr>
        <p style="color:#888;">OverAssessed - (888) 282-9165</p>
    `;
    
    try {
        await sgMail.send({
            to: 'tyler@overassessed.ai',
            from: process.env.SENDGRID_FROM_EMAIL || 'notifications@overassessed.ai',
            subject,
            html
        });
        console.log(`📧 Voicemail email sent for call from ${from}`);
    } catch (err) {
        console.error('Voicemail email error:', err.message);
    }
}
// ===== END TWILIO VOICE =====

// ===== PIPELINE SYSTEM =====
// Stage definitions: NEW → ANALYSIS → VERIFIED → READY_TO_FILE → PAYMENT_RECEIVED → FILED → REVIEW → WON → LOST
const PIPELINE_STAGES = ['New', 'Analysis', 'Preview Ready', 'Verified', 'Ready to File', 'Payment Received', 'Filed', 'Review', 'Won', 'Lost'];

const PIPELINE_RULES = {
    // What's required to enter each stage
    'Preview Ready': (lead) => {
        const errors = [];
        if (!lead.estimated_savings || lead.estimated_savings <= 0) errors.push('No savings estimate');
        if (!lead.county) errors.push('Missing county');
        if (!lead.property_address) errors.push('Missing property address');
        const av = parseInt(String(lead.assessed_value || '0').replace(/[\$,]/g, ''));
        if (!av) errors.push('Missing assessed value');
        // QA GATE: must pass QA before preview
        if (lead.qa_status !== 'passed') errors.push('QA not passed — no preview without verified data');
        return errors;
    },
    'Verified': (lead) => {
        const errors = [];
        // QA HARD GATE — nothing proceeds without QA pass
        if (lead.qa_status !== 'passed') errors.push('QA GATE: analysis has not passed quality assurance');
        if (lead.verification_status !== 'verified') errors.push('verification_status must be "verified"');
        if (!lead.comp_results?.comps?.length) errors.push('No comps found');
        // Check EVERY comp is real — zero synthetic tolerance
        const comps = lead.comp_results?.comps || [];
        const syntheticComps = comps.filter(c => c.source === 'synthetic-estimate' || c.source === 'synthetic');
        if (syntheticComps.length > 0) errors.push(`${syntheticComps.length} synthetic comps detected — ALL comps must be from real sources`);
        const hasRealComps = comps.some(c => c.source !== 'synthetic-estimate' && c.source !== 'synthetic');
        if (!hasRealComps && comps.length > 0) errors.push('Zero real comps — need county records or MLS data');
        // Validate each comp has required fields
        comps.forEach((c, i) => {
            if (!c.address) errors.push(`Comp ${i+1}: missing address`);
            if (!c.salePrice && !c.baseValue) errors.push(`Comp ${i+1}: missing sale price`);
            if (!c.saleDate && !c.soldDate) errors.push(`Comp ${i+1}: missing sale date`);
            if (!c.sqft) errors.push(`Comp ${i+1}: missing sqft`);
            if (!c.source || c.source === 'synthetic-estimate') errors.push(`Comp ${i+1}: invalid source "${c.source}"`);
        });
        if (!lead.estimated_savings || lead.estimated_savings <= 0) errors.push('No savings calculated');
        if (!lead.county) errors.push('Missing county');
        const av = parseInt(String(lead.assessed_value || '0').replace(/[\$,]/g, ''));
        if (!av) errors.push('Missing assessed value');
        return errors;
    },
    'Ready to File': (lead) => {
        const errors = PIPELINE_RULES['Verified'](lead);
        if (!lead.fee_agreement_signed) errors.push('Fee agreement not signed');
        if (!lead.property_address) errors.push('Missing property address');
        // Notice required for TX
        if (lead.state === 'TX' && !lead.notice_of_value && !lead.notice_file) {
            errors.push('Missing notice of value (required for TX)');
        }
        return errors;
    },
    'Payment Received': (lead) => {
        const errors = PIPELINE_RULES['Ready to File'](lead);
        if (!lead.initiation_paid && lead.payment_status !== 'paid') errors.push('Initiation fee not paid');
        return errors;
    },
    'Filed': (lead) => {
        const errors = PIPELINE_RULES['Payment Received'](lead);
        if (lead.filing_status === 'not_filed') errors.push('Filing not submitted');
        // v2 Filing Gate
        const gate = canFile(lead);
        if (!gate.allowed) errors.push('FILING GATE: ' + gate.reason);
        return errors;
    }
};

// Pipeline: validate stage transition
app.post('/api/pipeline/validate', authenticateToken, async (req, res) => {
    try {
        const { lead_id, target_stage } = req.body;
        if (!lead_id || !target_stage) return res.status(400).json({ error: 'lead_id and target_stage required' });
        if (!PIPELINE_STAGES.includes(target_stage)) return res.status(400).json({ error: 'Invalid stage', valid: PIPELINE_STAGES });

        const { data: lead, error } = await supabaseAdmin.from('submissions').select('*').eq('id', lead_id).single();
        if (error || !lead) return res.status(404).json({ error: 'Lead not found' });

        const validator = PIPELINE_RULES[target_stage];
        const errors = validator ? validator(lead) : [];

        res.json({
            lead_id,
            lead_name: lead.owner_name,
            current_stage: lead.status,
            target_stage,
            can_transition: errors.length === 0,
            blockers: errors,
            current_data: {
                verification_status: lead.verification_status,
                payment_status: lead.payment_status,
                filing_status: lead.filing_status,
                fee_signed: lead.fee_agreement_signed || false,
                initiation_paid: lead.initiation_paid || false,
                has_notice: !!(lead.notice_of_value || lead.notice_file),
                has_comps: !!(lead.comp_results?.comps?.length),
                has_real_comps: !!(lead.comp_results?.comps?.some(c => c.source !== 'synthetic-estimate')),
                estimated_savings: lead.estimated_savings,
                assessed_value: lead.assessed_value
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Pipeline: move lead to new stage (with validation)
app.post('/api/pipeline/transition', authenticateToken, async (req, res) => {
    try {
        const { lead_id, target_stage, force } = req.body;
        if (!lead_id || !target_stage) return res.status(400).json({ error: 'lead_id and target_stage required' });
        if (!PIPELINE_STAGES.includes(target_stage)) return res.status(400).json({ error: 'Invalid stage', valid: PIPELINE_STAGES });

        const { data: lead, error } = await supabaseAdmin.from('submissions').select('*').eq('id', lead_id).single();
        if (error || !lead) return res.status(404).json({ error: 'Lead not found' });

        // Validate unless forced by admin
        const validator = PIPELINE_RULES[target_stage];
        const errors = validator ? validator(lead) : [];
        if (errors.length > 0 && !force) {
            return res.status(422).json({
                error: 'Cannot transition — blockers exist',
                blockers: errors,
                hint: 'Set force=true to override (admin only)'
            });
        }

        // Build update
        const update = { status: target_stage, updated_at: new Date().toISOString() };
        if (target_stage === 'Won' || target_stage === 'Lost') {
            update.close_date = new Date().toISOString();
        }

        const { error: updateErr } = await supabaseAdmin.from('submissions').update(update).eq('id', lead_id);
        if (updateErr) return res.status(500).json({ error: updateErr.message });

        res.json({
            success: true,
            lead_id,
            lead_name: lead.owner_name,
            previous_stage: lead.status,
            new_stage: target_stage,
            forced: !!(errors.length > 0 && force),
            blockers_overridden: errors.length > 0 ? errors : undefined
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Pipeline: bulk validate all leads
app.get('/api/pipeline/audit', authenticateToken, async (req, res) => {
    try {
        const { data: leads, error } = await supabaseAdmin.from('submissions')
            .select('*').is('deleted_at', null).order('estimated_savings', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });

        const audit = leads.map(lead => {
            const verifyErrors = PIPELINE_RULES['Verified'](lead);
            const rtfErrors = PIPELINE_RULES['Ready to File'](lead);
            const payErrors = PIPELINE_RULES['Payment Received'](lead);
            const fileErrors = PIPELINE_RULES['Filed'](lead);

            let recommended_stage = 'New';
            if (fileErrors.length === 0) recommended_stage = 'Filed';
            else if (payErrors.length === 0) recommended_stage = 'Payment Received';
            else if (rtfErrors.length === 0) recommended_stage = 'Ready to File';
            else if (verifyErrors.length === 0) recommended_stage = 'Verified';
            else if (lead.comp_results?.comps?.length) recommended_stage = 'Analysis';

            return {
                id: lead.id,
                name: lead.owner_name,
                email: lead.email,
                current_stage: lead.status,
                recommended_stage,
                needs_correction: lead.status !== recommended_stage,
                estimated_savings: lead.estimated_savings,
                county: lead.county,
                verification_status: lead.verification_status,
                payment_status: lead.payment_status || 'unpaid',
                filing_status: lead.filing_status || 'not_filed',
                fee_signed: lead.fee_agreement_signed || false,
                initiation_paid: lead.initiation_paid || false,
                has_notice: !!(lead.notice_of_value || lead.notice_file),
                has_real_comps: !!(lead.comp_results?.comps?.some(c => c.source !== 'synthetic-estimate')),
                blockers: {
                    to_verified: verifyErrors,
                    to_ready: rtfErrors,
                    to_paid: payErrors,
                    to_filed: fileErrors
                }
            };
        });

        const summary = {
            total: audit.length,
            by_recommended: {},
            needs_correction: audit.filter(a => a.needs_correction).length,
            with_real_comps: audit.filter(a => a.has_real_comps).length,
            with_synthetic_only: audit.filter(a => !a.has_real_comps).length
        };
        audit.forEach(a => {
            summary.by_recommended[a.recommended_stage] = (summary.by_recommended[a.recommended_stage] || 0) + 1;
        });

        res.json({ summary, leads: audit });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ===== PREVIEW SYSTEM =====
// Generate customer-facing preview (NO proprietary data exposed)
app.get('/api/preview/:caseId', async (req, res) => {
    try {
        const caseId = req.params.caseId;
        const { data: lead, error } = await supabaseAdmin.from('submissions')
            .select('*').eq('case_id', caseId).is('deleted_at', null).single();
        if (error || !lead) return res.status(404).json({ error: 'Case not found' });

        // Parse assessed value
        const av = parseInt(String(lead.assessed_value || '0').replace(/[\$,]/g, ''));
        const savings = lead.estimated_savings || 0;

        // Calculate estimated range (±20% band around savings)
        const savingsLow = Math.round(savings * 0.7 / 100) * 100;
        const savingsHigh = Math.round(savings * 1.2 / 100) * 100;

        // Estimated value range (assessed minus savings range / tax rate)
        const taxRate = lead.analysis_report?.taxRate || lead.comp_results?.taxRate || 0.0225;
        const valueLow = av ? Math.round((av - (savingsHigh / taxRate)) / 1000) * 1000 : null;
        const valueHigh = av ? Math.round((av - (savingsLow / taxRate)) / 1000) * 1000 : null;

        // Determine high-level reasoning (no comp details)
        const compCount = lead.comp_results?.comps?.length || 0;
        let reasoning = '';
        if (compCount >= 3) {
            reasoning = `Our analysis of ${compCount} comparable properties in ${lead.county} County suggests your assessed value may be higher than current market conditions support.`;
        } else if (compCount > 0) {
            reasoning = `Our initial analysis of comparable properties in ${lead.county} County indicates a potential overassessment.`;
        } else {
            reasoning = `Based on market data for ${lead.county} County, your assessed value may be higher than supported by current conditions.`;
        }

        // Condition factors
        if (lead.condition_issues && lead.condition_issues !== 'No') {
            reasoning += ` Property condition factors may further support a reduction.`;
        }
        if (lead.year_built && (new Date().getFullYear() - lead.year_built) > 20) {
            reasoning += ` Age-related depreciation is also a factor in our assessment.`;
        }

        // State-specific deadline
        const deadlines = { TX: 'May 15, 2026', GA: '45 days after notice', WA: 'July 1, 2026', CO: 'June 1, 2026', AZ: 'Varies by county', OH: 'March 31, 2026' };
        const deadline = deadlines[lead.state] || 'Contact us for your deadline';

        // Generate preview HTML
        const firstName = (lead.owner_name || '').split(' ')[0];
        const preview = {
            caseId: lead.case_id,
            firstName,
            propertyAddress: lead.property_address,
            county: lead.county,
            state: lead.state,
            assessedValue: av ? `$${av.toLocaleString()}` : 'Under review',
            estimatedValueRange: valueLow && valueHigh ? `$${valueLow.toLocaleString()} – $${valueHigh.toLocaleString()}` : 'Analysis in progress',
            estimatedSavingsRange: savingsLow > 0 ? `$${savingsLow.toLocaleString()} – $${savingsHigh.toLocaleString()} per year` : 'Analysis in progress',
            reasoning,
            deadline,
            feeStructure: `${Math.round((lead.fee_rate || 0.25) * 100)}% of actual tax savings — you only pay if we reduce your taxes`,
            initiationFee: '$79',
            nextStep: lead.fee_agreement_signed ? 'Complete your filing authorization' : 'Review and sign your authorization to proceed'
        };

        // Return HTML or JSON based on Accept header
        if (req.headers.accept?.includes('text/html')) {
            res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your Property Tax Analysis | OverAssessed</title>
<style>
body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:0;background:#f8fafc;color:#1a1a2e}
.wrap{max-width:600px;margin:0 auto;padding:20px}
.header{background:linear-gradient(135deg,#6c5ce7,#0984e3);color:#fff;padding:30px;border-radius:12px 12px 0 0;text-align:center}
.header h1{margin:0;font-size:22px}.header p{margin:8px 0 0;color:#e8e8e8;font-size:14px}
.body{background:#fff;padding:30px;border:1px solid #e2e8f0;border-top:none}
.metric{background:#f1f5f9;border-radius:8px;padding:16px;margin:12px 0}
.metric-label{font-size:12px;text-transform:uppercase;color:#64748b;letter-spacing:0.5px}
.metric-value{font-size:24px;font-weight:700;color:#0984e3;margin-top:4px}
.metric-value.savings{color:#22c55e}
.reasoning{background:#fffbeb;border-left:3px solid #f59e0b;padding:16px;margin:16px 0;border-radius:0 8px 8px 0;font-size:14px;line-height:1.6}
.deadline{background:#fef2f2;border-left:3px solid #ef4444;padding:12px 16px;border-radius:0 8px 8px 0;font-size:14px}
.cta{display:block;background:linear-gradient(135deg,#6c5ce7,#0984e3);color:#fff;text-align:center;padding:16px;border-radius:50px;text-decoration:none;font-weight:700;font-size:16px;margin:24px 0}
.fee{text-align:center;font-size:13px;color:#64748b;margin:8px 0}
.footer{background:#1a1a2e;color:#94a3b8;padding:20px;border-radius:0 0 12px 12px;text-align:center;font-size:12px}
.disclaimer{font-size:11px;color:#94a3b8;margin-top:16px;line-height:1.5}
</style></head><body><div class="wrap">
<div class="header"><h1>Your Property Tax Analysis</h1><p>Case ${preview.caseId}</p></div>
<div class="body">
<p>Hi ${preview.firstName},</p>
<p>We've completed a preliminary analysis of your property and found a potential opportunity to reduce your property taxes.</p>
<div class="metric"><div class="metric-label">Your Property</div><div class="metric-value" style="font-size:16px;color:#1a1a2e">${preview.propertyAddress}</div></div>
<div class="metric"><div class="metric-label">County Assessed Value</div><div class="metric-value">${preview.assessedValue}</div></div>
<div class="metric"><div class="metric-label">Our Estimated Market Value Range</div><div class="metric-value">${preview.estimatedValueRange}</div></div>
<div class="metric"><div class="metric-label">Estimated Annual Tax Savings</div><div class="metric-value savings">${preview.estimatedSavingsRange}</div></div>
<div class="reasoning"><strong>Why we believe your assessment is too high:</strong><br>${preview.reasoning}</div>
<div class="deadline">⚠️ <strong>Filing Deadline:</strong> ${preview.deadline}</div>
<a class="cta" href="https://overassessed.ai/portal">Get Started →</a>
<p class="fee">${preview.feeStructure}<br>One-time initiation fee: ${preview.initiationFee}</p>
<p class="disclaimer">This is a preliminary estimate based on available market data. Actual savings will depend on the outcome of the formal protest process. Past results do not guarantee future outcomes. All figures are estimates and subject to change based on additional analysis and county review.</p>
</div>
<div class="footer">OverAssessed, LLC · San Antonio, Texas<br>(888) 282-9165 · support@overassessed.ai</div>
</div></body></html>`);
        } else {
            res.json(preview);
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Batch generate previews for all eligible leads
app.get('/api/previews/batch', authenticateToken, async (req, res) => {
    try {
        const { data: leads, error } = await supabaseAdmin.from('submissions')
            .select('case_id,owner_name,property_address,county,state,assessed_value,estimated_savings,status,verification_status')
            .is('deleted_at', null)
            .not('estimated_savings', 'is', null)
            .gt('estimated_savings', 0)
            .order('estimated_savings', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });

        const previews = leads.map(l => {
            const av = parseInt(String(l.assessed_value || '0').replace(/[\$,]/g, ''));
            const s = l.estimated_savings || 0;
            const sLow = Math.round(s * 0.7 / 100) * 100;
            const sHigh = Math.round(s * 1.2 / 100) * 100;
            return {
                caseId: l.case_id,
                name: l.owner_name,
                address: l.property_address,
                county: l.county,
                assessed: av ? `$${av.toLocaleString()}` : '?',
                savingsRange: sLow > 0 ? `$${sLow.toLocaleString()}–$${sHigh.toLocaleString()}/yr` : '?',
                status: l.status,
                previewUrl: `https://disciplined-alignment-production.up.railway.app/api/preview/${l.case_id}`
            };
        });

        res.json({ total: previews.length, previews });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// ===== END PREVIEW SYSTEM =====

// ===== QA AGENT =====
// Hard gate: validates ALL data before anything proceeds
app.post('/api/qa/run', authenticateToken, async (req, res) => {
    try {
        const { lead_id } = req.body;
        if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

        const { data: lead, error } = await supabaseAdmin.from('submissions').select('*').eq('id', lead_id).single();
        if (error || !lead) return res.status(404).json({ error: 'Lead not found' });

        const errors = [];
        const warnings = [];
        const compChecks = [];

        // 1. Assessed value validation
        const av = parseInt(String(lead.assessed_value || '0').replace(/[\$,]/g, ''));
        if (!av) errors.push({ field: 'assessed_value', msg: 'Missing or zero assessed value' });

        // 2. Property data source check
        const propSource = lead.property_data?.source || 'unknown';
        if (propSource === 'intake-fallback') {
            warnings.push({ field: 'property_data.source', msg: `Data from "${propSource}" — not verified against county records` });
        }

        // 3. COMP VALIDATION — zero synthetic tolerance
        const comps = lead.comp_results?.comps || [];
        if (comps.length === 0) {
            errors.push({ field: 'comps', msg: 'No comparable properties found' });
        }

        let realCompCount = 0;
        let syntheticCount = 0;
        comps.forEach((c, i) => {
            const check = { index: i + 1, address: c.address || '?', source: c.source || '?', issues: [] };

            // Source check
            if (!c.source || c.source === 'synthetic-estimate' || c.source === 'synthetic') {
                check.issues.push('SYNTHETIC — not a real sale');
                syntheticCount++;
            } else {
                realCompCount++;
            }

            // Required fields
            if (!c.address) check.issues.push('Missing address');
            if (!c.salePrice && !c.baseValue) check.issues.push('Missing sale price');
            if (!c.saleDate && !c.soldDate) check.issues.push('Missing sale date');
            if (!c.sqft || c.sqft <= 0) check.issues.push('Missing or invalid sqft');

            // Distance check
            if (c.distance && c.distance > 5) {
                check.issues.push(`Distance ${c.distance}mi — may be too far for reliable comp`);
            }

            // Age check (sale date)
            const saleDate = c.saleDate || c.soldDate;
            if (saleDate) {
                const monthsAgo = (Date.now() - new Date(saleDate).getTime()) / (1000 * 60 * 60 * 24 * 30);
                if (monthsAgo > 24) check.issues.push(`Sale date ${saleDate} — over 24 months old`);
            }

            check.valid = check.issues.length === 0;
            compChecks.push(check);
        });

        if (syntheticCount > 0) {
            errors.push({ field: 'comps', msg: `${syntheticCount} of ${comps.length} comps are SYNTHETIC — all must be real` });
        }
        if (realCompCount < 3 && comps.length > 0) {
            errors.push({ field: 'comps', msg: `Only ${realCompCount} real comps — minimum 3 required for defensible analysis` });
        }

        // 4. Savings math validation
        if (realCompCount >= 3 && av > 0) {
            const realComps = comps.filter(c => c.source !== 'synthetic-estimate' && c.source !== 'synthetic');
            const avgCompVal = realComps.reduce((s, c) => s + (c.salePrice || c.baseValue || 0), 0) / realComps.length;
            const taxRate = lead.analysis_report?.taxRate || lead.comp_results?.taxRate || 0.0225;
            const impliedSavings = Math.round((av - avgCompVal) * taxRate);
            const reportedSavings = lead.estimated_savings || 0;

            if (impliedSavings <= 0) {
                errors.push({ field: 'savings', msg: `Implied savings is $${impliedSavings} — comps don't support a reduction` });
            } else if (reportedSavings > impliedSavings * 1.5) {
                errors.push({ field: 'savings', msg: `Reported savings $${reportedSavings} is ${Math.round(reportedSavings/impliedSavings*100)/100}x the implied savings of $${impliedSavings}` });
            }
        }

        // 5. Required fields
        if (!lead.county) errors.push({ field: 'county', msg: 'Missing county' });
        if (!lead.property_address) errors.push({ field: 'property_address', msg: 'Missing property address' });
        if (!lead.state) errors.push({ field: 'state', msg: 'Missing state' });

        // VERDICT
        const passed = errors.length === 0;
        const qaResult = {
            passed,
            errors,
            warnings,
            compChecks,
            summary: {
                totalComps: comps.length,
                realComps: realCompCount,
                syntheticComps: syntheticCount,
                validComps: compChecks.filter(c => c.valid).length,
                assessedValue: av,
                reportedSavings: lead.estimated_savings,
                dataSource: propSource
            },
            runAt: new Date().toISOString()
        };

        // Update lead in Supabase
        await supabaseAdmin.from('submissions').update({
            qa_status: passed ? 'passed' : 'failed',
            qa_result: qaResult,
            qa_run_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }).eq('id', lead_id);

        res.json({
            lead_id,
            lead_name: lead.owner_name,
            case_id: lead.case_id,
            qa_status: passed ? 'passed' : 'failed',
            ...qaResult
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// QA: batch run on all active leads
app.post('/api/qa/batch', authenticateToken, async (req, res) => {
    try {
        const { data: leads, error } = await supabaseAdmin.from('submissions')
            .select('id,owner_name,case_id').is('deleted_at', null);
        if (error) return res.status(500).json({ error: error.message });

        // We'll just mark the status — actual QA runs per-lead
        const results = [];
        for (const lead of leads) {
            // Fetch full lead
            const { data: full } = await supabaseAdmin.from('submissions').select('*').eq('id', lead.id).single();
            if (!full) continue;

            const comps = full.comp_results?.comps || [];
            const synth = comps.filter(c => c.source === 'synthetic-estimate' || c.source === 'synthetic').length;
            const real = comps.length - synth;
            const av = parseInt(String(full.assessed_value || '0').replace(/[\$,]/g, ''));

            let status = 'failed';
            const issues = [];
            if (comps.length === 0) issues.push('no comps');
            if (synth > 0) issues.push(`${synth} synthetic comps`);
            if (real < 3) issues.push(`only ${real} real comps`);
            if (!av) issues.push('no assessed value');
            if (!full.county) issues.push('no county');
            if (issues.length === 0) status = 'passed';

            await supabaseAdmin.from('submissions').update({
                qa_status: status,
                qa_run_at: new Date().toISOString()
            }).eq('id', lead.id);

            results.push({
                name: full.owner_name,
                case_id: full.case_id,
                qa_status: status,
                issues: issues.length > 0 ? issues : ['all checks passed']
            });
        }

        const passed = results.filter(r => r.qa_status === 'passed').length;
        const failed = results.filter(r => r.qa_status === 'failed').length;

        res.json({
            total: results.length,
            passed,
            failed,
            results
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// ===== END QA AGENT =====

// Pipeline: Stripe webhook handler for payment_status
// NO AUTH — Stripe webhooks can't send tokens
app.post('/api/stripe/pipeline-webhook', async (req, res) => {
    try {
        const event = req.body;
        if (event.type === 'checkout.session.completed') {
            const session = event.data?.object;
            const leadId = session?.metadata?.lead_id;
            if (leadId) {
                await supabaseAdmin.from('submissions').update({
                    initiation_paid: true,
                    initiation_paid_at: new Date().toISOString(),
                    payment_status: 'paid',
                    status: 'Payment Received',
                    updated_at: new Date().toISOString()
                }).eq('id', leadId);
                console.log(`[Pipeline] Payment received for lead ${leadId}`);
            }
        }
        res.json({ received: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// ===== END PIPELINE SYSTEM =====

// ===== REAL COMP ENGINE =====

// Fetch real comps for a single lead
app.post('/api/comps/fetch', authenticateToken, async (req, res) => {
    try {
        const { lead_id, dry_run } = req.body;
        if (!lead_id) return res.status(400).json({ error: 'lead_id required' });
        
        const { data: leads, error } = await supabaseAdmin
            .from('submissions')
            .select('*')
            .eq('id', lead_id)
            .is('deleted_at', null);
        
        if (error || !leads?.length) return res.status(404).json({ error: 'Lead not found' });
        const lead = leads[0];
        
        console.log(`[RealCompEngine] Fetching comps for: ${lead.owner_name} (${lead.property_address})`);
        const result = await fetchRealComps(lead);
        
        if (!dry_run) {
            // Write results to Supabase
            const updateData = {
                comp_results: {
                    comps: result.comps,
                    value_range: result.value_range,
                    confidence: result.confidence,
                    fetched_at: result.fetched_at,
                    data_sources: result.data_sources,
                    appraisal_analysis: result.appraisal_analysis
                },
                data_sources: result.data_sources,
                estimated_savings: result.estimated_savings?.annual || 0,
                updated_at: new Date().toISOString()
            };
            
            // If insufficient data, mark for manual review
            if (result.insufficient_data) {
                updateData.needs_manual_review = true;
                updateData.review_reason = `INSUFFICIENT_DATA: Only ${result.comp_count} valid comps (need 3)`;
            }
            
            const { error: updateError } = await supabaseAdmin
                .from('submissions')
                .update(updateData)
                .eq('id', lead_id);
            
            if (updateError) {
                console.error('[RealCompEngine] Update failed:', updateError);
                result.db_write = 'failed';
                result.db_error = updateError.message;
            } else {
                result.db_write = 'success';
            }
        } else {
            result.db_write = 'dry_run';
        }
        
        res.json(result);
    } catch (e) {
        console.error('[RealCompEngine] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Fetch real comps for multiple leads (batch)
app.post('/api/comps/batch', authenticateToken, async (req, res) => {
    try {
        const { lead_ids, all, dry_run, delay_ms } = req.body;
        
        let leads;
        if (all) {
            const { data, error } = await supabaseAdmin
                .from('submissions')
                .select('*')
                .is('deleted_at', null)
                .order('created_at', { ascending: true });
            if (error) return res.status(500).json({ error: error.message });
            leads = data;
        } else if (lead_ids?.length) {
            const { data, error } = await supabaseAdmin
                .from('submissions')
                .select('*')
                .in('id', lead_ids)
                .is('deleted_at', null);
            if (error) return res.status(500).json({ error: error.message });
            leads = data;
        } else {
            return res.status(400).json({ error: 'lead_ids array or all=true required' });
        }
        
        console.log(`[RealCompEngine] Batch: ${leads.length} leads, dry_run=${!!dry_run}`);
        const results = await fetchRealCompsBatch(leads, delay_ms || 2000);
        
        // Write results if not dry run
        if (!dry_run) {
            let written = 0, failed = 0;
            for (const result of results) {
                if (result.error) { failed++; continue; }
                const updateData = {
                    comp_results: {
                        comps: result.comps,
                        value_range: result.value_range,
                        confidence: result.confidence,
                        fetched_at: result.fetched_at,
                        data_sources: result.data_sources,
                        appraisal_analysis: result.appraisal_analysis
                    },
                    data_sources: result.data_sources,
                    estimated_savings: result.estimated_savings?.annual || 0,
                    updated_at: new Date().toISOString()
                };
                if (result.insufficient_data) {
                    updateData.needs_manual_review = true;
                    updateData.review_reason = `INSUFFICIENT_DATA: Only ${result.comp_count} valid comps (need 3)`;
                }
                const { error } = await supabaseAdmin
                    .from('submissions')
                    .update(updateData)
                    .eq('id', result.lead_id);
                if (error) failed++;
                else written++;
            }
            res.json({ total: leads.length, results_summary: {
                written, failed,
                sufficient: results.filter(r => !r.insufficient_data && !r.error).length,
                insufficient: results.filter(r => r.insufficient_data).length,
                errors: results.filter(r => r.error).length
            }, results });
        } else {
            res.json({ total: leads.length, dry_run: true, results });
        }
    } catch (e) {
        console.error('[RealCompEngine] Batch error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Re-run QA after comp fetch
app.post('/api/comps/fetch-and-qa', authenticateToken, async (req, res) => {
    try {
        const { lead_id } = req.body;
        if (!lead_id) return res.status(400).json({ error: 'lead_id required' });
        
        // Step 1: Fetch real comps
        const { data: leads, error } = await supabaseAdmin
            .from('submissions')
            .select('*')
            .eq('id', lead_id)
            .is('deleted_at', null);
        
        if (error || !leads?.length) return res.status(404).json({ error: 'Lead not found' });
        const lead = leads[0];
        
        console.log(`[RealCompEngine] Fetch+QA for: ${lead.owner_name}`);
        const compResult = await fetchRealComps(lead);
        
        // Write comp results
        await supabaseAdmin
            .from('submissions')
            .update({
                comp_results: {
                    comps: compResult.comps,
                    value_range: compResult.value_range,
                    confidence: compResult.confidence,
                    fetched_at: compResult.fetched_at,
                    data_sources: compResult.data_sources,
                    appraisal_analysis: compResult.appraisal_analysis
                },
                data_sources: compResult.data_sources,
                estimated_savings: compResult.estimated_savings?.annual || 0,
                needs_manual_review: compResult.insufficient_data,
                review_reason: compResult.insufficient_data ? `INSUFFICIENT_DATA: Only ${compResult.comp_count} valid comps` : null,
                updated_at: new Date().toISOString()
            })
            .eq('id', lead_id);
        
        // Step 2: Re-fetch updated lead and run QA
        const { data: updated } = await supabaseAdmin
            .from('submissions')
            .select('*')
            .eq('id', lead_id)
            .single();
        
        // Run QA inline (same logic as /api/qa/run)
        const qaResult = runQACheck(updated);
        
        // Write QA results
        await supabaseAdmin
            .from('submissions')
            .update({
                qa_status: qaResult.passed ? 'passed' : 'failed',
                qa_result: qaResult,
                qa_run_at: new Date().toISOString()
            })
            .eq('id', lead_id);
        
        res.json({
            comp_result: compResult,
            qa_result: qaResult,
            lead_name: lead.owner_name,
            qa_passed: qaResult.passed
        });
    } catch (e) {
        console.error('[RealCompEngine] Fetch+QA error:', e);
        res.status(500).json({ error: e.message });
    }
});

// QA check helper (extracted for reuse)
function runQACheck(lead) {
    const errors = [];
    const warnings = [];
    const compChecks = [];
    
    if (!lead.comp_results?.comps?.length) errors.push({ field: 'comps', msg: 'No comps found' });
    
    const comps = lead.comp_results?.comps || [];
    const syntheticComps = comps.filter(c => c.source === 'synthetic-estimate' || c.source === 'synthetic');
    const realComps = comps.filter(c => c.source !== 'synthetic-estimate' && c.source !== 'synthetic');
    
    if (syntheticComps.length > 0) {
        errors.push({ field: 'comps', msg: `${syntheticComps.length} of ${comps.length} comps are SYNTHETIC — all must be real` });
    }
    if (realComps.length < 3) {
        errors.push({ field: 'comps', msg: `Only ${realComps.length} real comps — minimum 3 required for defensible analysis` });
    }
    
    // Sale date is MANDATORY — comps without sale dates are not defensible
    const compsWithDates = realComps.filter(c => c.sale_date);
    if (compsWithDates.length < 3 && realComps.length >= 3) {
        errors.push({ field: 'comps', msg: `Only ${compsWithDates.length} of ${realComps.length} comps have sale dates — minimum 3 with dates required` });
    }
    
    const assessed = parseFloat(String(lead.assessed_value || '0').replace(/[,$]/g, ''));
    const savings = lead.estimated_savings;
    if (assessed && savings) {
        const savingsRatio = savings / assessed;
        if (savingsRatio > 0.15) warnings.push({ field: 'savings', msg: `Savings ${(savingsRatio*100).toFixed(1)}% of assessed — unusually high` });
    }
    
    if (lead.property_data?.source === 'intake-fallback') {
        warnings.push({ field: 'property_data.source', msg: `Data from "intake-fallback" — not verified against county records` });
    }
    
    for (let i = 0; i < comps.length; i++) {
        const c = comps[i];
        const issues = [];
        if (!c.source || c.source === 'synthetic-estimate' || c.source === 'synthetic') {
            issues.push(`SYNTHETIC — not a real sale`);
        }
        if (!c.sale_date) issues.push('Missing sale date');
        if (!c.sale_price || c.sale_price <= 0) issues.push('Missing sale price');
        if (!c.sqft || c.sqft <= 0) issues.push('Missing sqft');
        if (!c.address || c.address.length < 5) issues.push('Invalid address');
        
        // Check for placeholder/fake addresses
        if (c.address && /^\d{4,5}\s/.test(c.address)) {
            const streetNum = parseInt(c.address);
            if (streetNum > 9000 && c.source !== 'redfin-mls' && c.source !== 'rentcast-api') {
                issues.push('Possible fabricated address (high street number)');
            }
        }
        
        // Check sqft match to subject (if available)
        const subjectSqft = lead.sqft || lead.property_data?.sqft;
        if (subjectSqft && c.sqft) {
            const ratio = c.sqft / subjectSqft;
            if (ratio < 0.60 || ratio > 1.50) {
                issues.push(`SqFt mismatch: comp ${c.sqft} vs subject ${subjectSqft} (${Math.round(ratio*100)}%)`);
            }
        }
        
        // Check price reasonableness vs assessed
        const subjectAssessed = parseFloat(String(lead.assessed_value || '0').replace(/[,$]/g, ''));
        if (subjectAssessed && c.sale_price) {
            const priceRatio = c.sale_price / subjectAssessed;
            if (priceRatio < 0.15 || priceRatio > 5) {
                issues.push(`Price mismatch: comp $${c.sale_price?.toLocaleString()} vs assessed $${subjectAssessed.toLocaleString()}`);
            }
        }
        
        compChecks.push({
            index: i + 1,
            address: c.address,
            source: c.source,
            valid: issues.length === 0,
            issues
        });
    }
    
    return {
        passed: errors.length === 0,
        errors,
        warnings,
        compChecks,
        summary: {
            totalComps: comps.length,
            realComps: realComps.length,
            syntheticComps: syntheticComps.length,
            validComps: compChecks.filter(c => c.valid).length,
            assessedValue: assessed,
            reportedSavings: savings,
            confidence: lead.comp_results?.confidence || 'unknown',
            dataSource: lead.property_data?.source || 'unknown'
        },
        runAt: new Date().toISOString()
    };
}

// ===== END REAL COMP ENGINE =====

// ===== LEAD DASHBOARD =====
// ========== COMMAND CENTER (v2 — static dashboard) ==========
app.get('/admin/command-center', (req, res) => {
    res.sendFile(require('path').join(__dirname, 'public', 'admin', 'command-center.html'));
});

// ========== COMMAND CENTER (v1 — legacy server-rendered) ==========
app.get('/admin/command-center-legacy', authenticateToken, async (req, res) => {
    try {
        const { data: leads } = await supabaseAdmin.from('submissions')
            .select('*').is('deleted_at', null).order('estimated_savings', { ascending: false });
        const total = leads.length;
        const byStatus = {};
        leads.forEach(l => byStatus[l.status] = (byStatus[l.status]||0)+1);
        const signed = leads.filter(l => l.fee_agreement_signed || ['Form Signed','Filing Prepared'].includes(l.status));
        const filingReady = leads.filter(l => l.status === 'Filing Prepared');
        const submitted = leads.filter(l => l.status === 'Submitted');
        const totalSavings = leads.reduce((s,l) => s + (l.estimated_savings||0), 0);
        const totalFees = leads.reduce((s,l) => s + Math.round((l.estimated_savings||0) * (l.fee_rate||0.25)), 0);
        const missingNotice = leads.filter(l => !l.notice_of_value && !l.notice_file).length;
        const missingAssessed = leads.filter(l => { const v = l.assessed_value; if (!v) return true; const n = parseInt(String(v).replace(/[\$,]/g,'')); return isNaN(n) || n === 0; }).length;
        const missingCounty = leads.filter(l => !l.county).length;
        const paid = leads.filter(l => l.initiation_paid).length;
        const hot = leads.filter(l => l.estimated_savings > 2000).slice(0, 10);
        res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OA Command Center</title><style>
body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:16px;background:#0f172a;color:#e2e8f0}
h1{color:#38bdf8;margin:0 0 4px}.sub{color:#94a3b8;margin-bottom:16px;font-size:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:20px}
.card{background:#1e293b;padding:14px;border-radius:8px;text-align:center}
.card-val{font-size:1.8rem;font-weight:800;color:#38bdf8}.card-label{font-size:11px;color:#94a3b8;text-transform:uppercase;margin-top:2px}
.card-alert .card-val{color:#f59e0b}.card-danger .card-val{color:#ef4444}.card-green .card-val{color:#22c55e}
.section{background:#1e293b;border-radius:8px;padding:16px;margin-bottom:16px}
.section h2{color:#38bdf8;font-size:16px;margin:0 0 10px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;padding:6px 8px;color:#94a3b8;border-bottom:1px solid #334155}
td{padding:6px 8px;border-bottom:1px solid #1e293b}tr:hover{background:#334155}
.tag{display:inline-block;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:600}
.tag-ready{background:#065f46;color:#6ee7b7}.tag-pending{background:#713f12;color:#fbbf24}.tag-filed{background:#1e3a5f;color:#93c5fd}
.savings{color:#4ade80;font-weight:700}
.blocker{background:#7f1d1d;border-left:3px solid #ef4444;padding:8px 12px;border-radius:4px;margin:4px 0;font-size:13px}
a{color:#38bdf8;text-decoration:none}
</style></head><body>
<h1>\uD83C\uDFAF OA Command Center</h1>
<p class="sub">Live from Supabase \u00b7 ${new Date().toLocaleString('en-US',{timeZone:'America/Chicago'})}</p>
<div class="grid">
<div class="card"><div class="card-val">${total}</div><div class="card-label">Total Leads</div></div>
<div class="card card-green"><div class="card-val">${signed.length}</div><div class="card-label">Signed Clients</div></div>
<div class="card card-green"><div class="card-val">${filingReady.length}</div><div class="card-label">Filing Ready</div></div>
<div class="card card-green"><div class="card-val">${submitted.length}</div><div class="card-label">Filed</div></div>
<div class="card"><div class="card-val">$${totalSavings.toLocaleString()}</div><div class="card-label">Total Savings</div></div>
<div class="card"><div class="card-val">$${totalFees.toLocaleString()}</div><div class="card-label">Potential Fees</div></div>
<div class="card card-danger"><div class="card-val">${paid}</div><div class="card-label">Paid</div></div>
<div class="card card-alert"><div class="card-val">${missingNotice}</div><div class="card-label">Missing Notice</div></div>
</div>
<div class="section"><h2>Pipeline</h2><table>
<tr><th>Stage</th><th>Count</th></tr>
${Object.entries(byStatus).sort((a,b)=>b[1]-a[1]).map(([s,c])=>'<tr><td>'+s+'</td><td>'+c+'</td></tr>').join('')}
</table></div>
<div class="section"><h2>Top 10 Leads</h2><table>
<tr><th>Name</th><th>County</th><th>Savings</th><th>Status</th><th>Notice</th><th>Fee Signed</th></tr>
${hot.map(l=>'<tr><td>'+(l.owner_name||'?')+'</td><td>'+(l.county||'\u2014')+'</td><td class="savings">$'+(l.estimated_savings||0).toLocaleString()+'/yr</td><td><span class="tag tag-'+(l.status==='Filing Prepared'?'ready':l.status==='Submitted'?'filed':'pending')+'">'+(l.status||'?')+'</span></td><td>'+(l.notice_of_value?'\u2705':'\u274C')+'</td><td>'+(l.fee_agreement_signed?'\u2705':'\u2014')+'</td></tr>').join('')}
</table></div>
<div class="section"><h2>Blockers</h2>
${missingNotice>0?'<div class="blocker">'+missingNotice+'/'+total+' missing Notice of Appraised Value</div>':''}
${missingAssessed>0?'<div class="blocker">'+missingAssessed+'/'+total+' missing assessed value</div>':''}
${missingCounty>0?'<div class="blocker">'+missingCounty+'/'+total+' missing county</div>':''}
${paid===0?'<div class="blocker">0 initiation fees collected \u2014 '+signed.length+' signed clients unpaid</div>':''}
</div>
<div class="section"><h2>Email Queue</h2><p>10 queued \u00b7 <a href="/admin/emails">Review & Approve \u2192</a></p></div>
<div class="section"><h2>Today\'s Actions</h2>
<ol style="margin:0;padding-left:20px;font-size:13px">
<li>Review outreach emails at <a href="/admin/emails">/admin/emails</a></li>
<li>File protests for Jason Matthews + Shabir Rupani</li>
<li>Collect initiation fees from ${signed.length} signed clients</li>
<li>Request notice uploads from ${missingNotice} leads</li>
</ol></div>
<script>setTimeout(()=>location.reload(),60000);</script>
</body></html>`);
    } catch(e) { res.status(500).send('Error: '+e.message); }
});

app.get('/dashboard/leads', async (req, res) => {
    // Simple auth: ?key=oa-dash-2026
    if (req.query.key !== 'oa-dash-2026') {
        return res.status(401).send('Unauthorized. Add ?key=oa-dash-2026');
    }
    
    try {
        const { data: leads, error } = await supabaseAdmin
            .from('submissions')
            .select('case_id,email,owner_name,property_address,phone,state,county,status,drip_state,estimated_savings,assessed_value,fee_agreement_signed,created_at,updated_at')
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(200);
        
        if (error) throw error;
        
        const rows = (leads || []).map(l => {
            const ds = l.drip_state || {};
            const savings = ds.estimatedSavings || l.estimated_savings || null;
            const assessed = ds.assessedValue || null;
            const recommended = ds.recommendedValue || null;
            const priority = savings && savings > 1000 ? '🔴 HIGH' : savings && savings > 500 ? '🟡 MED' : savings ? '🟢 LOW' : '⭕ UNSCORED';
            return { ...l, savings, assessed, recommended, priority, assignee: ds.assignee || 'Unassigned', analyzed: !!ds.analysisComplete };
        }).sort((a, b) => (b.savings || 0) - (a.savings || 0));
        
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OA Lead Dashboard</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:20px;background:#0f172a;color:#e2e8f0}
  h1{color:#38bdf8;margin-bottom:4px}
  .sub{color:#94a3b8;margin-bottom:20px}
  table{width:100%;border-collapse:collapse;font-size:0.85rem}
  th{background:#1e293b;padding:10px 8px;text-align:left;color:#38bdf8;position:sticky;top:0}
  td{padding:8px;border-bottom:1px solid #1e293b}
  tr:hover{background:#1e293b}
  .tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600}
  .analyzed{background:#065f46;color:#6ee7b7}
  .needs-docs{background:#713f12;color:#fbbf24}
  .contacted{background:#1e3a5f;color:#93c5fd}
  .new{background:#4a1942;color:#f0abfc}
  .savings{color:#4ade80;font-weight:700}
  .stats{display:flex;gap:16px;margin-bottom:20px}
  .stat{background:#1e293b;padding:12px 20px;border-radius:8px;text-align:center}
  .stat-val{font-size:1.5rem;font-weight:700;color:#38bdf8}
  .stat-label{font-size:0.75rem;color:#94a3b8}
</style></head><body>
<h1>🎯 OA Lead Dashboard</h1>
<p class="sub">/simple funnel leads — sorted by highest savings</p>
<div class="stats">
  <div class="stat"><div class="stat-val">${rows.length}</div><div class="stat-label">Total Leads</div></div>
  <div class="stat"><div class="stat-val">${rows.filter(r=>r.analyzed).length}</div><div class="stat-label">Analyzed</div></div>
  <div class="stat"><div class="stat-val">${rows.filter(r=>r.status==='Needs Data').length}</div><div class="stat-label">Needs Docs</div></div>
  <div class="stat"><div class="stat-val">${rows.filter(r=>r.phone).length}</div><div class="stat-label">Has Phone</div></div>
  <div class="stat"><div class="stat-val">$${rows.reduce((s,r)=>s+(r.savings||0),0).toLocaleString()}</div><div class="stat-label">Total Savings</div></div>
</div>
<table>
<tr><th>Case</th><th>Priority</th><th>Name / Email</th><th>Address</th><th>State</th><th>Savings</th><th>Assessed</th><th>Status</th><th>Assignee</th><th>Submitted</th></tr>
${rows.map(r => `<tr>
  <td>${r.case_id}</td>
  <td>${r.priority}</td>
  <td>${r.owner_name !== 'Simple Form Lead' ? r.owner_name + '<br>' : ''}${r.email}${r.phone ? '<br>📞 '+r.phone : ''}</td>
  <td>${r.property_address}</td>
  <td>${r.state || '?'}</td>
  <td class="savings">${r.savings ? '$'+r.savings.toLocaleString()+'/yr' : '—'}</td>
  <td>${r.assessed ? '$'+r.assessed.toLocaleString() : '—'}</td>
  <td><span class="tag ${(r.status||'').toLowerCase().replace(/\s/g,'-')}">${r.status || 'New'}</span></td>
  <td>${r.assignee}</td>
  <td>${new Date(r.created_at).toLocaleString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</td>
</tr>`).join('')}
</table>
</body></html>`;
        
        res.send(html);
    } catch (err) {
        console.error('[Dashboard] Error:', err.message);
        res.status(500).send('Dashboard error: ' + err.message);
    }
});

app.listen(PORT, async () => {
        console.log(`🚀 OverAssessed running on port ${PORT}`);
        console.log(`📱 SMS: ${twilioClient ? 'Enabled' : 'Disabled'}`);
        console.log(`📧 Email: ${process.env.SENDGRID_API_KEY ? 'Enabled' : 'Disabled'}`);
        console.log(`👤 Notify: ${process.env.NOTIFY_PHONE || 'N/A'} | ${process.env.NOTIFY_EMAIL || 'N/A'}`);
        console.log(`🔄 Drip sequence: checking every hour`);
        console.log(`💳 Stripe: ${process.env.STRIPE_SECRET_KEY ? 'Enabled (auto-invoice)' : 'Disabled'}`);
        console.log(`🔍 Outcome monitor: checking every 6 hours`);

        // Initialize Stripe initiation fee product
        if (process.env.STRIPE_SECRET_KEY && stripeRouter.initializeInitiationFeeProduct) {
            await stripeRouter.initializeInitiationFeeProduct();
            console.log(`💰 Initiation fee ($79) product initialized`);
        }
    });

    // Run drip check every hour (pre-sign reminders)
    setInterval(runDripCheck, 60 * 60 * 1000);
    setTimeout(runDripCheck, 30000);
    
    // Run contacted follow-up every 4 hours (post-results follow-up)
    setInterval(runContactedFollowUp, 4 * 60 * 60 * 1000);
    setTimeout(runContactedFollowUp, 60000); // 1 min after startup

    // Run outcome monitor every 6 hours (checks county sites for hearing results)
    setInterval(async () => {
        try {
            const result = await checkAllPendingOutcomes();
            if (result.updated > 0) {
                console.log(`[OutcomeMonitor] Updated ${result.updated} appeals`);
            }
        } catch (e) {
            console.error('[OutcomeMonitor] Scheduled check error:', e.message);
        }
    }, 6 * 60 * 60 * 1000);
    // First check 2 minutes after startup
    setTimeout(async () => {
        try { await checkAllPendingOutcomes(); } catch (e) { console.error('[OutcomeMonitor]', e.message); }
    }, 120000);
}

startServer();

// ─── TikTok OAuth Routes ───────────────────────────────────────────────────
app.get('/tiktok/auth', (req, res) => {
    const clientKey = process.env.TIKTOK_CLIENT_KEY || '7616556737608288268';
    const redirectUri = encodeURIComponent('https://overassessed.ai/tiktok/callback');
    const scope = encodeURIComponent('user.info.basic,video.upload,video.publish');
    const state = require('crypto').randomBytes(16).toString('hex');
    const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&scope=${scope}&response_type=code&redirect_uri=${redirectUri}&state=${state}`;
    res.redirect(authUrl);
});

app.get('/tiktok/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.redirect('/tiktok/?error=' + error);
    if (!code) return res.redirect('/tiktok/?error=no_code');
    // Exchange code for token (in production)
    // For now, redirect to content manager as connected
    res.redirect('/tiktok/?connected=true');
});

// ===== EMAIL APPROVAL QUEUE UI =====
app.get('/api/email-queue', (req, res) => {
    res.json(emailApprovalQueue.map((e, i) => ({
        id: i,
        to: e.to,
        subject: e.subject,
        tier: e.tier || 'approval-required',
        queuedAt: e.queuedAt,
        status: e.status
    })));
});

app.get('/api/email-queue/:id', (req, res) => {
    const email = emailApprovalQueue[parseInt(req.params.id)];
    if (!email) return res.status(404).json({ error: 'Not found' });
    res.json(email);
});

app.post('/api/email-queue/:id/approve', async (req, res) => {
    const email = emailApprovalQueue[parseInt(req.params.id)];
    if (!email) return res.status(404).json({ error: 'Not found' });
    if (email.status !== 'pending_approval') return res.json({ error: 'Already processed', status: email.status });
    try {
        await sendNotificationEmail(email.subject, email.html, email.to);
        email.status = 'approved_sent';
        email.approvedAt = new Date().toISOString();
        console.log(`[EMAIL APPROVED] ✅ "${email.subject}" → ${email.to}`);
        res.json({ success: true, status: 'sent' });
    } catch (err) {
        email.status = 'send_failed';
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/email-queue/:id/reject', (req, res) => {
    const email = emailApprovalQueue[parseInt(req.params.id)];
    if (!email) return res.status(404).json({ error: 'Not found' });
    email.status = 'rejected';
    email.rejectedAt = new Date().toISOString();
    email.rejectReason = req.body?.reason || 'Rejected by Tyler';
    console.log(`[EMAIL REJECTED] ❌ "${email.subject}" → ${email.to}`);
    res.json({ success: true, status: 'rejected' });
});

// Version check
app.get('/api/version', (req, res) => {
    res.json({ version: '2.6.0-v2', deployedAt: new Date().toISOString(), tadLoaded: tarrantData.isLoaded() });
});

// ===== INTERNAL SYSTEMS DIRECTORY =====
app.get('/internal/systems', (req, res) => {
    // Auth: simple token check
    const token = req.query.key || req.headers['x-auth-key'];
    if (token !== 'oa-dash-2026') {
        return res.status(401).send('Unauthorized');
    }
    
    const systems = [
        { name: 'OA Lead Dashboard', url: 'https://overassessed.ai/dashboard/leads?key=oa-dash-2026', status: '✅ Live', auth: 'Query key', owner: 'Tyler', desc: '/simple funnel leads — sorted by savings' },
        { name: 'OA /simple Landing Page', url: 'https://overassessed.ai/simple', status: '✅ Live', auth: 'Public', owner: 'Tyler', desc: 'Simplified lead capture — 2 fields + phone' },
        { name: 'OA Admin Dashboard', url: 'https://overassessed.ai/admin', status: '✅ Live', auth: 'tyler@overassessed.ai', owner: 'Tyler', desc: 'Full case management + analysis' },
        { name: 'WortheyFlow CRM (Render)', url: 'https://wortheyflow.onrender.com', status: '✅ Live (NEW)', auth: 'tyler@wortheyaquatics.com', owner: 'Tyler', desc: 'Lead management + automation — GHL webhook target' },
        { name: 'WortheyFlow CRM (Railway)', url: 'https://wortheyflow-production.up.railway.app', status: '⚠️ Retiring', auth: 'tyler@wortheyaquatics.com', owner: 'Tyler', desc: 'Old deployment — webhook switching to Render' },
        { name: 'Mission Control (Render)', url: 'https://mission-control-x2mr.onrender.com', status: '✅ Live', auth: 'WortheyMC!2026', owner: 'Tyler', desc: 'Agent orchestration + project overview' },
        { name: 'Mission Control (Local)', url: 'http://192.168.1.186:4000', status: '✅ Running', auth: 'WortheyMC!2026', owner: 'AquaBot', desc: 'Local Mac Mini instance (LAN only)' },
        { name: 'MilePilot API', url: 'https://milepilot-api-op2s.onrender.com', status: '✅ Live', auth: 'JWT', owner: 'Tyler', desc: 'Backend API for MilePilot app' },
        { name: 'MilePilot Landing', url: 'https://milepilot.app', status: '✅ Live', auth: 'Public', owner: 'Tyler', desc: 'Marketing landing page' },
        { name: 'GHL / GoHighLevel', url: 'https://app.techfektor.com', status: '✅ Active', auth: 'tyler@wortheyaquatics.com', owner: 'Pool Monopoly', desc: 'Lead source CRM (Teckfactor managed)' },
        { name: 'Supabase (OA)', url: 'https://ylxreuqvofgbpsatfsvr.supabase.co', status: '✅ Active', auth: 'tyler@overassessed.ai', owner: 'Tyler', desc: 'OA database — submissions, cases, analytics' },
        { name: 'Supabase (MilePilot)', url: 'https://sxgvtocpgdpbxodzkdmt.supabase.co', status: '✅ Active', auth: 'aquabot1000@icloud.com', owner: 'Tyler', desc: 'MilePilot database — users, trips, subscriptions' },
    ];
    
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Worthey Enterprise — Systems Directory</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:20px;background:#0f172a;color:#e2e8f0}
  h1{color:#38bdf8;margin-bottom:4px}
  .sub{color:#94a3b8;margin-bottom:24px}
  .card{background:#1e293b;border-radius:10px;padding:16px 20px;margin-bottom:12px;border-left:4px solid #38bdf8}
  .card:hover{background:#263548}
  .card h3{margin:0 0 4px;color:#f1f5f9}
  .card h3 a{color:#38bdf8;text-decoration:none}
  .card h3 a:hover{text-decoration:underline}
  .meta{display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;font-size:0.8rem;color:#94a3b8}
  .meta span{background:#0f172a;padding:2px 8px;border-radius:4px}
  .desc{color:#cbd5e1;font-size:0.9rem;margin-top:4px}
  .status-live{color:#4ade80} .status-warn{color:#fbbf24} .status-off{color:#f87171}
  .section{margin-top:32px;padding-top:16px;border-top:1px solid #334155}
  .section h2{color:#94a3b8;font-size:0.9rem;text-transform:uppercase;letter-spacing:1px}
  .ts{text-align:center;color:#475569;font-size:0.75rem;margin-top:32px}
</style></head><body>
<h1>🏢 Worthey Enterprise — Systems Directory</h1>
<p class="sub">Internal reference — all active systems, dashboards, and APIs</p>

${['OverAssessed', 'Worthey Aquatics', 'MilePilot', 'Infrastructure'].map(section => {
    const sectionMap = {
        'OverAssessed': s => s.name.includes('OA') || s.name.includes('OverAssessed') || s.url.includes('overassessed'),
        'Worthey Aquatics': s => s.name.includes('Worthey') || s.name.includes('GHL') || s.url.includes('worthey'),
        'MilePilot': s => s.name.includes('MilePilot') || s.url.includes('milepilot'),
        'Infrastructure': s => s.name.includes('Mission') || s.name.includes('Supabase'),
    };
    const items = systems.filter(sectionMap[section]);
    if (!items.length) return '';
    return '<div class="section"><h2>' + section + '</h2>' + items.map(s => 
        '<div class="card"><h3><a href="' + s.url + '" target="_blank">' + s.name + '</a> <span class="' + 
        (s.status.includes('✅') ? 'status-live' : s.status.includes('⚠') ? 'status-warn' : 'status-off') + 
        '" style="font-size:0.8rem">' + s.status + '</span></h3>' +
        '<p class="desc">' + s.desc + '</p>' +
        '<div class="meta"><span>🔑 ' + s.auth + '</span><span>👤 ' + s.owner + '</span></div></div>'
    ).join('') + '</div>';
}).join('')}

<p class="ts">Last updated: ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })}</p>
</body></html>`;
    
    res.send(html);
});
// deploy trigger 1775355980
