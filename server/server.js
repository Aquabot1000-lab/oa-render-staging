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

// Supabase routes (new database layer — runs alongside existing file-based routes)
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
const { checkAllPendingOutcomes } = require('./services/outcome-monitor');

// Twilio setup
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

// SendGrid setup
if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
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

        // Reject fallback/estimated data for the public estimator — only show real CAD values
        if (propertyData.source === 'intake-fallback') {
            console.warn('[Estimator] Rejecting fallback data — CAD lookup timed out or failed');
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
        referralId: row.referral_id,
        stripeCustomerId: row.stripe_customer_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        deletedAt: row.deleted_at || null,
        followUpDate: row.follow_up_date || null,
        followUpNote: row.follow_up_note || null
    };
}

// Read all submissions — Supabase primary, file fallback
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

// Write (upsert) a submission — Supabase primary, JSON always (dual-write for safety)
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
            // Both failed — this is critical
            console.error('[Submissions] CRITICAL: Both Supabase and JSON write failed!', jsonErr.message);
            throw jsonErr;
        }
        console.warn('[Submissions] JSON backup write failed (Supabase OK):', jsonErr.message);
    }
}

// Update submission in place — Supabase primary, file fallback
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
        console.log('[Init] Admin user reset — tyler@overassessed.ai / OverAssessed!2026');
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
            // No submissions yet in Supabase — check local counter then start at 1
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

// Notifications
async function sendSMS(to, message) {
    if (!twilioClient) { console.log('SMS skipped - no Twilio client'); return; }
    if (!to) { console.log('SMS skipped - no recipient'); return; }
    try {
        await twilioClient.messages.create({
            body: message,
            from: process.env.TWILIO_SMS_NUMBER || process.env.TWILIO_PHONE_NUMBER,
            to
        });
        console.log('SMS sent to', to);
    } catch (error) {
        console.error('SMS failed:', error.message);
    }
}

async function sendNotificationSMS(message) {
    await sendSMS(process.env.NOTIFY_PHONE, message);
}

async function sendClientSMS(phone, message) {
    // Normalize phone to E.164
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 10) cleaned = '1' + cleaned;
    if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
    await sendSMS(cleaned, message);
}

async function sendNotificationEmail(subject, html, toEmail) {
    if (!process.env.SENDGRID_API_KEY) {
        console.log('Email skipped - missing config');
        return;
    }
    const to = toEmail || process.env.NOTIFY_EMAIL;
    if (!to) { console.log('Email skipped - no recipient'); return; }
    try {
        await sgMail.send({
            to,
            from: { email: process.env.SENDGRID_FROM_EMAIL || 'notifications@wortheyaquatics.com', name: 'OverAssessed' },
            replyTo: { email: 'tyler@overassessed.ai', name: 'Tyler Worthey' },
            subject,
            html,
            trackingSettings: { clickTracking: { enable: false }, openTracking: { enable: false } }
        });
        console.log('Email sent to', to);
    } catch (error) {
        console.error('Email failed:', error.message);
    }
}

async function sendClientEmail(toEmail, subject, html) {
    await sendNotificationEmail(subject, html, toEmail);
}

function buildNotificationContent(sub) {
    const sms = `🏠 New OverAssessed Lead!\n\nCase: ${sub.caseId}\nName: ${sub.ownerName}\nProperty: ${sub.propertyAddress}\nType: ${sub.propertyType}\nPhone: ${sub.phone}\nEmail: ${sub.email}${sub.assessedValue ? `\nAssessed: ${sub.assessedValue}` : ''}`;

    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px;">
            <div style="background: linear-gradient(135deg, #6c5ce7, #0984e3); color: white; padding: 20px; border-radius: 8px 8px 0 0;">
                <h3 style="margin: 0;">🏠 New OverAssessed Lead — ${sub.caseId}</h3>
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
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #6c5ce7, #0984e3); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">${title}</h1>
            ${subtitle ? `<p style="margin: 8px 0 0; opacity: 0.9;">${subtitle}</p>` : ''}
        </div>
        <div style="background: white; padding: 30px; border: 1px solid #e2e8f0; border-top: none;">
            ${bodyHtml}
        </div>
        <div style="background: #1a1a2e; color: white; padding: 20px; border-radius: 0 0 12px 12px; text-align: center; font-size: 13px; opacity: 0.8;">
            OverAssessed, LLC — San Antonio, Texas<br>
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
            <p style="font-size: 13px; color: #6b7280; text-align: center;">Or <a href="${portalUrl}" style="color: #6c5ce7;">view your client portal</a> — log in with your email and case ID: <strong>${sub.caseId}</strong></p>
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
                <p>Great news — our team has completed the analysis for your property at <strong>${sub.propertyAddress}</strong>.</p>
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
                : `OverAssessed: Your analysis is ready${sub.estimatedSavings ? ` — estimated savings: $${sub.estimatedSavings.toLocaleString()}/yr` : ''}! Sign your authorization form to proceed: ${getBaseUrl()}/sign/${sub.caseId}`
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
                <p>Our team will represent you — no action is needed on your part. We'll let you know the outcome as soon as the hearing concludes.</p>
                <div style="text-align:center;margin:20px 0;">
                    <a href="${portalUrl}" style="background:linear-gradient(135deg,#6c5ce7,#0984e3);color:white;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:700;">View Your Portal</a>
                </div>`,
            sms: `OverAssessed: A hearing has been scheduled for your property tax protest. Our team will represent you — no action needed!`
        },
        'Resolved': {
            title: 'Your Case is Resolved! ✅',
            subtitle: `Case ${sub.caseId}`,
            body: `<p>Hi ${sub.ownerName},</p>
                <p>Great news — your property tax protest for <strong>${sub.propertyAddress}</strong> has been resolved!</p>
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
                sendClientEmail(sub.email, `Reminder: Sign Your Authorization — ${sub.caseId}`,
                    brandedEmailWrapper('Quick Reminder', `Case ${sub.caseId}`, `
                        <p>Hi ${sub.ownerName},</p>
                        <p>Just a friendly reminder — we still need your signed Form 50-162 to proceed with your property tax protest for <strong>${sub.propertyAddress}</strong>.</p>
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
                sendClientSMS(sub.phone, `OverAssessed reminder: We still need your signed authorization to file your property tax protest. Sign here: ${signUrl}`);
                drip.reminder48 = new Date().toISOString();
                changed = true;
            }

            // 72hr final email + SMS to Tyler
            if (hoursSince >= 72 && !drip.reminder72) {
                console.log(`[Drip] 72hr final reminder → ${sub.email} + Tyler alert (${sub.caseId})`);
                sendClientEmail(sub.email, `Action Needed: Don't Miss Out — ${sub.caseId}`,
                    brandedEmailWrapper('Don\'t Miss Your Deadline', `Case ${sub.caseId}`, `
                        <p>Hi ${sub.ownerName},</p>
                        <p>We haven't received your signed authorization yet for <strong>${sub.propertyAddress}</strong>. Property tax protest deadlines are approaching and we don't want you to miss out on potential savings.</p>
                        <p>Please take a moment to sign — it only takes 60 seconds:</p>
                        <div style="text-align:center;margin:25px 0;">
                            <a href="${signUrl}" style="background:linear-gradient(135deg,#e17055,#d63031);color:white;padding:14px 32px;border-radius:50px;text-decoration:none;font-weight:700;">Sign Before It's Too Late →</a>
                        </div>
                        <p>If you have any questions or concerns, please reply to this email or call us at (888) 282-9165.</p>
                    `)
                );
                // Alert Tyler to call them
                sendNotificationSMS(`⚠️ Follow-up needed!\n${sub.ownerName} hasn't signed Form 50-162 after 72hrs.\nCase: ${sub.caseId}\nPhone: ${sub.phone}\nPlease call them.`);
                sendNotificationEmail(`⚠️ Follow-up Needed — ${sub.caseId} ${sub.ownerName}`,
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

// ==================== SUPABASE DB ROUTES (new — /api/db/*) ====================
// These run alongside existing file-based routes. Existing routes are untouched.
if (isSupabaseEnabled()) {
    console.log('✅ Supabase enabled — mounting /api/db/* routes');
    app.use('/api/db/clients', authenticateToken, clientsRouter);
    app.use('/api/db/properties', authenticateToken, propertiesRouter);
    app.use('/api/db/appeals', authenticateToken, appealsRouter);
    app.use('/api/db/documents', authenticateToken, documentsRouter);
    app.use('/api/db/payments', authenticateToken, paymentsRouter);
    app.use('/api/db/exemptions', authenticateToken, exemptionsRouter);
    app.use('/api/db/referrals', authenticateToken, referralsRouter);
    app.use('/api/filings', authenticateToken, filingsRouter);
    app.use('/api/admin/uri-commissions', authenticateToken, uriCommissionsRouter);
} else {
    console.log('⚠️  Supabase not configured — /api/db/* routes disabled');
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
    // Coinbase Commerce Bitcoin payment routes (all public — webhook needs raw body)
    app.use('/api/coinbase', coinbaseRouter);
    app.use('/api/email', emailNurtureRouter);
    console.log('✅ Public routes mounted: /api/exemptions, /api/referrals, /api/stripe, /api/coinbase, /api/email');
}

// ==================== ROUTES ====================

// ==================== OUTCOME MONITOR ROUTES ====================
// POST /api/admin/check-outcomes — manually trigger outcome check for all pending appeals
app.post('/api/admin/check-outcomes', authenticateToken, async (req, res) => {
    try {
        const result = await checkAllPendingOutcomes();
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==================== CONFIRM SAVINGS & AUTO-BILL ====================
// POST /api/admin/confirm-savings — confirm savings, auto-charge or send invoice
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
                result = await chargeSavedCard(clientId, null, fee, `Property Tax Appeal Fee — ${sub.caseId} — ${(feeRate*100).toFixed(0)}% of $${verifiedSavings.toLocaleString()} savings`);
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
                description: `Property Tax Appeal Fee — ${sub.caseId} — ${(feeRate*100).toFixed(0)}% of $${verifiedSavings.toLocaleString()} savings`
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
                    <p style="margin:0;"><strong>Payment:</strong> ${method === 'auto_charge' ? 'Charged to your card on file — receipt sent separately by Stripe' : 'Invoice sent to your email — due in 30 days'}</p>
                </div>
                <p>Thank you for trusting OverAssessed with your property tax appeal. We'll continue monitoring your property for future increases.</p>
            `);
            sendClientEmail(sub.email, `🎉 Your Property Tax Appeal Won — $${verifiedSavings.toLocaleString()} Saved! (${sub.caseId})`, receiptHtml);
        } catch (notifyErr) {
            console.log('[Billing] Client notification failed:', notifyErr.message);
        }

        // Notify Tyler
        sendNotificationSMS(`💰 ${sub.caseId} — Savings confirmed: $${verifiedSavings.toLocaleString()} | Fee: $${fee.toFixed(2)} | ${method === 'auto_charge' ? 'Auto-charged' : 'Invoice sent'}`);

        console.log(`[Billing] ✅ ${sub.caseId} — $${fee.toFixed(2)} ${method} for $${verifiedSavings.toLocaleString()} savings`);
        res.json({ success: true, method, fee, email: sub.email, ...result });

    } catch (err) {
        console.error('[Billing] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==================== RENTCAST ANALYSIS ROUTES ====================
// POST /api/analysis/run — full RentCast + ArcGIS analysis for any address
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

// GET /api/analysis/comps — comparables only
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
 * Strips comp details, evidence packets, raw property data, and methodology —
 * clients only see the savings number and confidence, NOT the underlying data.
 */
function sanitizeForPortal(sub) {
    const safe = { ...sub };

    // Strip raw analysis data — clients don't get comp addresses, scores, or methodology
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
                <li><strong>Sign authorization</strong> — lets us file on your behalf</li>
                <li><strong>We build your case</strong> — comparable sales, evidence packet, filing</li>
                <li><strong>We attend your hearing</strong> — our experts represent you</li>
                <li><strong>You save money</strong> — only pay if we reduce your taxes</li>
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

        // Return sanitized data — no comp details, evidence, or methodology
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
                    from: { email: process.env.SENDGRID_FROM_EMAIL || 'notifications@wortheyaquatics.com', name: 'OverAssessed' },
                    replyTo: { email: 'tyler@overassessed.ai', name: 'Tyler Worthey' },
                    subject: '✅ You\'re Pre-Registered for TX Property Tax Season!',
                    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;">
                        <h2 style="color:#6c5ce7;">You're on the list, ${name}!</h2>
                        <p>We'll analyze <strong>${property_address}</strong> in <strong>${county} County</strong> the moment appraisal notices drop in April.</p>
                        <p>You'll get a head start on your protest — no action needed until then.</p>
                        <p style="color:#636e72;font-size:14px;">— The OverAssessed Team</p>
                    </div>`
                });
            } catch (e) { console.error('Pre-reg confirmation email failed:', e.message); }
        }
        // Notify admin
        try { await sendNotificationSMS(`New pre-registration: ${name} (${email}) — ${property_address}, ${county} County`); } catch(e) {}
        try { await sendNotificationEmail('New Pre-Registration', `<p><strong>${name}</strong> (${email})<br>${property_address}<br>${county} County</p>`); } catch(e) {}

        res.json({ success: true, id: data.id });
    } catch (error) {
        console.error('Pre-registration error:', error);
        res.status(500).json({ error: 'Failed to save pre-registration' });
    }
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
            return res.status(400).json({ error: 'Missing required fields' });
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
                        console.log(`[Intake] Duplicate detected — email: ${normalizedEmail}, existing case: ${addressMatch.case_id}`);
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
                    const discountedRate = 0.20; // Referral discount: 20% vs standard 25%
                    submission.referralCode = ref;
                    submission.discountedRate = discountedRate;
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

                    console.log(`[Intake] Referral ${ref} applied — discounted rate: ${discountedRate}`);
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

        // Send welcome notification to client via stage notification engine
        const notifyFns = { sendClientSMS, sendClientEmail, brandedEmailWrapper };
        sendStageNotification(submission, 'submitted', {}, notifyFns);

        // Also send the rich welcome email (existing branded flow)
        const welcomeHtml = buildWelcomeEmail(submission);
        sendClientEmail(email, `Welcome to OverAssessed — Case ${caseId}`, welcomeHtml);

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

        // Auto-trigger full analysis pipeline (async, don't block response)
        setTimeout(async () => {
            try {
                console.log(`[AutoAnalysis] Starting auto-analysis for new case ${caseId}`);
                await runFullAnalysis(submission.id);
                console.log(`[AutoAnalysis] Complete for ${caseId}`);
                // Notify Tyler that analysis is ready
                sendNotificationSMS(`📊 Auto-analysis complete!\nCase: ${caseId}\nProperty: ${propertyAddress}\nEvidence packet ready for review.`);
                sendNotificationEmail(`📊 Analysis Ready — ${caseId} ${ownerName}`,
                    `<p>Auto-analysis complete for <strong>${caseId}</strong> — ${propertyAddress}.</p>
                    <p>Evidence packet is generated and ready for review in the admin dashboard.</p>`);
                // Notify CLIENT that their analysis is ready (was missing — bug fix 2026-03-10)
                const updatedSub = await findSubmission(submission.id);
                if (updatedSub) {
                    const notifyFns = { sendClientSMS, sendClientEmail, brandedEmailWrapper };
                    const template = buildStatusEmail(updatedSub, 'Analysis Complete', {});
                    if (template) {
                        sendClientEmail(email, `${template.title} — ${caseId}`, brandedEmailWrapper(template.title, template.subtitle, template.body));
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
            feeAgreementSigned: !!sub.feeAgreementSignature
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
        const smsMsg = `🏢 NEW COMMERCIAL LEAD!\n${name}${companyName ? ' (' + companyName + ')' : ''}\n${propertyType} — ${propertyAddress}\nValue: ${assessedValue || 'Not provided'}\nProperties: ${propertyCount || '1'}\nPhone: ${phone}\nEmail: ${email}\nCase: ${caseId}`;
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

        // Send welcome notification to client
        const notifyFns = { sendClientSMS, sendClientEmail, brandedEmailWrapper };
        sendStageNotification(submission, 'submitted', {}, notifyFns);

        // Send welcome email
        const welcomeHtml = buildWelcomeEmail(submission);
        sendClientEmail(email, `Welcome to OverAssessed — Case ${caseId}`, welcomeHtml);

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

        console.log(`[Commercial] New lead: ${caseId} — ${name} (${propertyType}) at ${propertyAddress}`);
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

            // Fee Agreement Signature
            const feeRates = { TX: '25%', GA: '25%', WA: '25%', AZ: '25%', CO: '25%' };
            submissions[idx].feeAgreementSignature = {
                fullName: feeAgreementName,
                authorized: true,
                signedAt: new Date().toISOString(),
                ipAddress: req.ip,
                applicableRate: feeRates[state] || '25%',
                state: state
            };
            submissions[idx].fee_agreement_signed = true;
            submissions[idx].fee_agreement_signed_at = new Date().toISOString();

            if (['New', 'Analysis Complete'].includes(submissions[idx].status)) {
                submissions[idx].status = 'Form Signed';
            }
            submissions[idx].updatedAt = new Date().toISOString();
        });

        if (!sub) return res.status(404).json({ error: 'Case not found' });

        const state = sub.state || 'TX';
        const formName = state === 'GA' ? 'Service Agreement & Letter of Authorization' : 'Form 50-162';
        const feeRates = { TX: '25%', GA: '25%', WA: '25%', AZ: '25%', CO: '25%' };
        const feeRate = feeRates[state] || '25%';

        // Notify Tyler
        sendNotificationEmail(
            `${formName} + Fee Agreement Signed — ${sub.caseId} ${sub.ownerName}`,
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
                    <p style="margin-top:12px;padding:12px;background:#e8f5e9;border-radius:8px;"><strong>✅ Both agreements signed — ready for auto-charge on savings confirmation</strong></p>
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

    // Step 1: Fetch property data
    console.log(`[Analysis] Step 1: Fetching property data...`);
    const propertyData = await fetchPropertyData(sub);
    submissions[idx].propertyData = propertyData;
    await saveProgress();

    // Step 2: Check if we have real assessed value — never use synthetic/default data
    const assessedNum = propertyData.assessedValue || parseInt((sub.assessedValue || '0').replace(/[^0-9]/g, '')) || 0;
    const hasRealValue = assessedNum > 0 && propertyData.source !== 'intake-fallback';

    if (!hasRealValue) {
        console.warn(`[Analysis] No real assessed value for ${sub.caseId} — skipping analysis. Source: ${propertyData.source}, value: ${assessedNum}`);
        submissions[idx].unreliableData = true;
        submissions[idx].needsManualReview = true;
        submissions[idx].reviewReason = 'No real assessed value available — county lookup failed or returned fallback data. Waiting for client to upload their notice of appraised value.';
        submissions[idx].status = 'Analysis Complete';
        submissions[idx].analysisStatus = 'Awaiting Notice Upload';
        submissions[idx].updatedAt = new Date().toISOString();
        await saveProgress();

        // DO NOT send any client email when analysis is flagged/unreliable
        // Standing rule: No client emails until analysis is confirmed correct with no flags
        console.log(`[Analysis] Holding all client emails for ${sub.caseId} — unreliable data, needs manual review`);

        // Still notify Tyler about the lead (internal only)
        const { sms, html } = buildNotificationContent(sub);
        sendNotificationSMS(`[NEEDS REVIEW - NO EMAIL SENT] ${sms}`);

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
    // assessedNum already validated above — guaranteed to be real
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
            ? 'PROTEST RECOMMENDED — Strong basis for reduction based on comparable sales analysis.'
            : 'Assessment appears in line with market. Limited protest potential.',
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
    if (submissions[idx].status === 'New') {
        submissions[idx].status = 'Analysis Complete';
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
        console.log(`[Analysis] ${sub.caseId}: Missing data (${missingFields.join(', ')}) — sending info request email`);
        submissions[idx].missingDataRequested = true;
        submissions[idx].missingFields = missingFields;
        await saveProgress();

        const mvSavings = compResults.marketValueAnalysis?.estimatedSavings || compResults.estimatedSavings || 0;
        const missingList = missingFields.map(f => `• ${f.charAt(0).toUpperCase() + f.slice(1)}`).join('<br>');

        const infoRequestHtml = `
            <p>Hi ${sub.ownerName},</p>
            <p>Great news — we've completed an initial analysis of your property at <strong>${sub.propertyAddress}</strong> and found potential savings of <strong>$${mvSavings.toLocaleString()}/year</strong>.</p>

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
                `${sub.ownerName} — We Found $${mvSavings.toLocaleString()}/yr Savings (+ Potential for More)`,
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
                        <div style="font-size: 14px; font-weight: 800; color: #e17055; margin-top: 2px;">$${eu.subjectPSF || '—'}</div>
                    </td>
                    <td style="background: #f0eeff; padding: 6px 10px; border: 1px solid #d5d0f5; width: 33%; text-align: center;">
                        <div style="font-size: 8px; color: #7c7c96; text-transform: uppercase;">Median Comp $/SqFt</div>
                        <div style="font-size: 14px; font-weight: 800; color: #00b894; margin-top: 2px;">$${eu.medianPSF || '—'}</div>
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
                        <td style="padding: 3px 5px; text-align: right; font-size: 9px;">${c.sqft ? c.sqft.toLocaleString() : '—'}</td>
                        <td style="padding: 3px 5px; text-align: right; font-size: 9px;">$${c.compPSF || '—'}</td>
                        <td style="padding: 3px 5px; text-align: right; font-size: 9px; font-weight: 600; color: ${(c.adjustedValue || 0) < assessedNum ? '#00b894' : '#e17055'};">$${(c.adjustedValue || 0).toLocaleString()}</td>
                        <td style="padding: 3px 5px; text-align: right; font-size: 9px; color: ${(c.adjustments?.size || 0) >= 0 ? '#00b894' : '#e17055'};">${c.adjustments ? (c.adjustments.size >= 0 ? '+' : '') + '$' + Math.abs(c.adjustments.size || 0).toLocaleString() : '—'}</td>
                        <td style="padding: 3px 5px; text-align: right; font-size: 9px; color: ${(c.adjustments?.age || 0) >= 0 ? '#00b894' : '#e17055'};">${c.adjustments ? (c.adjustments.age >= 0 ? '+' : '') + '$' + Math.abs(c.adjustments.age || 0).toLocaleString() : '—'}</td>
                        <td style="padding: 3px 5px; text-align: right; font-size: 9px; color: ${(c.adjustments?.land || 0) >= 0 ? '#00b894' : '#e17055'};">${c.adjustments ? (c.adjustments.land >= 0 ? '+' : '') + '$' + Math.abs(c.adjustments.land || 0).toLocaleString() : '—'}</td>
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
                    ${(compResults.comps || []).some(c => c.accountId && !c.accountId.startsWith('R')) ? `<td style="padding: 4px 6px; font-size: 10px; font-weight: 700; color: #6c5ce7;">${c.accountId || '—'}</td>` : ''}
                    <td style="padding: 4px 6px; font-size: 10px;">${c.address}</td>
                    <td style="padding: 4px 6px; text-align: right; font-size: 10px;">$${(c.assessedValue || 0).toLocaleString()}</td>
                    <td style="padding: 4px 6px; text-align: right; font-size: 10px; font-weight: 700; color: ${(c.adjustedValue || 0) < assessedNum ? '#00b894' : '#e17055'};">$${(c.adjustedValue || 0).toLocaleString()}</td>
                    <td style="padding: 4px 6px; text-align: right; font-size: 10px;">${c.sqft ? c.sqft.toLocaleString() : '—'}</td>
                    <td style="padding: 4px 6px; text-align: right; font-size: 10px;">${c.yearBuilt || '—'}</td>
                    <td style="padding: 4px 6px; text-align: right; font-size: 10px;">${c.pricePerSqft ? '$' + c.pricePerSqft : '—'}</td>
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
        // All emails require Tyler's approval — no auto-sends on analysis completion
        const sub = await findSubmission(req.params.id);
        const hasFlags = result.unreliableData || (result.compResults && result.compResults.unreliableData);
        console.log(`[Analysis] ${sub?.caseId || req.params.id} — analysis complete. Unreliable: ${hasFlags}. Holding all client emails for manual review.`);

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
            `Notice Uploaded — ${sub.caseId}`,
            `<p>Client ${sub.ownerName} uploaded their Notice of Appraised Value for case ${sub.caseId}.</p>`
        );

        res.json({ success: true, message: 'Notice uploaded', filePath });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Failed to upload notice' });
    }
});

// ==================== PIPELINE STATS ====================
app.get('/api/pipeline-stats', authenticateToken, async (req, res) => {
    try {
        const submissions = await readAllSubmissions();
        const statuses = ['New', 'Analysis Complete', 'Form Signed', 'Protest Filed', 'Hearing Scheduled', 'Resolved'];
        const pipeline = {};
        statuses.forEach(s => pipeline[s] = 0);
        // Count statuses — normalize "Signed" → "Form Signed" for pipeline
        const statusMap = { 'Signed': 'Form Signed', 'New Submission': 'New' };
        submissions.forEach(s => {
            const mapped = statusMap[s.status] || s.status;
            if (pipeline[mapped] !== undefined) {
                pipeline[mapped]++;
            } else if (pipeline[s.status] !== undefined) {
                pipeline[s.status]++;
            } else {
                pipeline[s.status] = (pipeline[s.status] || 0) + 1;
            }
        });

        const totalEstimatedSavings = submissions.reduce((sum, s) => sum + (s.estimatedSavings || 0), 0);
        const totalFees = Math.round(totalEstimatedSavings * 0.25);
        const signed = submissions.filter(s => s.signature).length;
        const notices = submissions.filter(s => s.noticeOfValue).length;

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
                sendClientEmail(sub.email, `${template.title} — ${sub.caseId}`, brandedEmailWrapper(template.title, template.subtitle, template.body));
                sendClientSMS(sub.phone, template.sms);
                console.log(`Status notification sent to ${sub.email} for ${status}`);
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
// GET /api/submissions/deleted — list soft-deleted records
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

// GET /api/submissions/follow-ups-due — leads with follow_up_date <= today
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
                sendClientEmail(sub.email, `${template.title} — ${sub.caseId}`, brandedEmailWrapper(template.title, template.subtitle, template.body));
                sendClientSMS(sub.phone, template.sms);
            }
        }

        res.json(sub);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update submission' });
    }
});

// ==================== SOFT DELETE ENDPOINTS ====================
// DELETE /api/submissions/:id — soft delete (set deleted_at)
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

// POST /api/submissions/:id/restore — restore soft-deleted record
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
// GET /api/submissions/:id/notes — get all notes for a submission
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

// POST /api/submissions/:id/notes — add a note to a submission
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
// PATCH /api/submissions/:id/follow-up — set follow-up date and note
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

app.post('/api/notify', authenticateToken, async (req, res) => {
    try {
        const { submissionId } = req.body;
        const sub = await findSubmission(submissionId);
        if (!sub) return res.status(404).json({ error: 'Submission not found' });

        const { sms, html } = buildNotificationContent(sub);
        await sendNotificationSMS(sms);
        await sendNotificationEmail('OverAssessed — Re-notification: ' + sub.ownerName, html);
        res.json({ success: true, message: 'Notifications sent' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to send notifications' });
    }
});

app.get('/api/stats', authenticateToken, async (req, res) => {
    try {
        const submissions = await readAllSubmissions();
        const total = submissions.length;
        const active = submissions.filter(s => ['New', 'Analysis Complete', 'Form Signed', 'Protest Filed', 'Hearing Scheduled', 'In Review', 'Appeal Filed'].includes(s.status)).length;
        const won = submissions.filter(s => s.status === 'Won' || s.status === 'Resolved').length;
        const lost = submissions.filter(s => s.status === 'Lost').length;
        const decided = won + lost;
        const winRate = decided > 0 ? Math.round((won / decided) * 100) : 0;
        const totalSavings = submissions.reduce((sum, s) => sum + (parseFloat(s.savings) || 0), 0);

        res.json({ total, active, won, lost, winRate, totalSavings });
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

// Portal deep link with UUID token — look up case ID and redirect to sign page
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

app.get('/georgia', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'georgia.html'));
});

app.get('/ohio', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'ohio.html'));
});
app.get('/lp/ohio', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'ohio.html'));
});

app.get('/arizona', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'arizona.html'));
});

app.get('/colorado', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'colorado.html'));
});

app.get('/commercial', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'commercial.html'));
});

app.get('/texas', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'texas.html'));
});

// Washington state + county pages
app.get('/washington', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'washington.html'));
});
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
app.get('/colorado', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'colorado.html'));
});
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
app.get('/arizona', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'lp', 'arizona.html'));
});
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

// Catch-all: serve frontend
app.get('{*path}', (req, res) => {
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
            console.log('⚠️  Tarrant CAD data not available — using synthetic comps for Tarrant County');
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

const AI_SYSTEM_PROMPT = `You are Sarah, the friendly and knowledgeable phone receptionist at OverAssessed. You sound natural, warm, confident, and helpful — like a real person who genuinely cares, not a robot reading a script.

ABOUT OVERASSESSED:
- Property tax protest experts serving all of Texas AND Georgia
- How it works: Give us your property address → we run a free analysis → if you're overpaying, we file the protest and handle everything → you save money
- Pricing: 20% of tax savings in Texas, 25% in Georgia. Just a $79 initiation fee to get started, which gets credited toward your contingency fee.
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
- Sound natural. Use contractions freely — "we'll", "you're", "that's", "don't".
- When someone gives info, REPEAT IT BACK: "Got it, so that's John Smith at 123 Main Street in San Antonio, right?"
- If speech sounds garbled: "Sorry, I didn't quite catch that. Could you repeat that for me?"
- If they ask something you don't know: "That's a great question. Tyler can go into more detail on that when he follows up with your analysis. Want me to get your info so he can reach out?"
- ALWAYS steer the conversation toward collecting their info
- Your name is Sarah. You're the front office assistant.
- NEVER use markdown, bullet points, asterisks, numbered lists, or any formatting
- Be conversational and warm. Laugh naturally if something's funny. Be human.
- If they seem hesitant: "I totally understand. There's zero risk — the analysis is completely free and there's no obligation. We just need your address to check if you're overpaying."
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

// 1. Inbound call — AI greeting + first gather
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

// 2. AI respond — process speech, get AI response, gather again
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
            // Outside business hours — tell them Tyler will call back
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
        // Tyler didn't answer — voicemail fallback
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

// 5. Call complete — send summary notifications
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
    
    // SMS to Tyler — short summary
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
    
    // Email to Tyler — full transcript
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
                subject: `📞 AI Call from ${callerNumber} — ${callTime}`,
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
                    <p style="color:#888;font-size:12px;">OverAssessed Phone — (888) 282-9165</p>
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
        <h2>New Voicemail — OverAssessed</h2>
        <p><strong>From:</strong> ${from}</p>
        <p><strong>Time:</strong> ${new Date().toLocaleString('en-US', {timeZone: 'America/Chicago'})}</p>
        ${transcription ? `<p><strong>Transcription:</strong> ${transcription}</p>` : ''}
        ${recordingUrl ? `<p><strong>Listen:</strong> <a href="${recordingUrl}">${recordingUrl}</a></p>` : ''}
        <hr>
        <p style="color:#888;">OverAssessed — (888) 282-9165</p>
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

    // Run drip check every hour
    setInterval(runDripCheck, 60 * 60 * 1000);
    // Also run once 30 seconds after startup
    setTimeout(runDripCheck, 30000);

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

// Version check
app.get('/api/version', (req, res) => {
    res.json({ version: '2.5.0-tad', deployedAt: new Date().toISOString(), tadLoaded: tarrantData.isLoaded() });
});
