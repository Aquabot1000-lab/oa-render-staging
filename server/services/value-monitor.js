/**
 * Value Monitor — checks county CAD websites for 2026 appraised values.
 * Runs daily to detect when new values are posted, then triggers protest filing.
 * 
 * Supported counties: Fort Bend (FBCAD), Collin, Hunt, and extensible for more.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const { supabaseAdmin, isSupabaseEnabled } = require('../lib/supabase');

// ─── Configuration ─────────────────────────────────────────
const STATE_FILE = path.join(__dirname, '..', 'filing-monitor-state.json');

const TYLER_PHONE = '210-559-8725';
const TYLER_EMAIL = 'tyler@overassessed.ai';

// County-specific property search URLs
const COUNTY_CONFIGS = {
    'Fort Bend': {
        name: 'Fort Bend Central Appraisal District',
        abbrev: 'FBCAD',
        searchBaseUrl: 'https://esearch.fbcad.org',
        propertyUrl: (accountId) => `https://esearch.fbcad.org/Property/View/${accountId}`,
        efileUrl: 'https://www.fbcad.org/appeals/',
        supportsEfile: true,
        parseValues: parseFBCADValues,
    },
    'Collin': {
        name: 'Collin Central Appraisal District',
        abbrev: 'CCAD',
        searchBaseUrl: 'https://esearch.collincad.org',
        propertyUrl: (accountId) => `https://esearch.collincad.org/Property/View/${accountId}`,
        agentPortalUrl: 'https://agent.collincad.org/index.php',
        supportsEfile: false, // Collin uses agent portal (requires Agent ID)
        parseValues: parseCollinCADValues,
    },
    'Hunt': {
        name: 'Hunt County Appraisal District',
        abbrev: 'HCAD-Hunt',
        searchBaseUrl: 'https://esearch.huntcad.org',
        propertyUrl: (accountId) => `https://esearch.huntcad.org/Property/View/${accountId}`,
        supportsEfile: false,
        parseValues: parseGenericTrueAutomationValues,
    }
};

// ─── State Management ──────────────────────────────────────
function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        }
    } catch (err) {
        console.error('[ValueMonitor] Error loading state:', err.message);
    }
    return {
        lastRun: null,
        clients: {},
        log: []
    };
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function addLogEntry(state, message, level = 'info') {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message
    };
    state.log.push(entry);
    // Keep last 500 log entries
    if (state.log.length > 500) {
        state.log = state.log.slice(-500);
    }
    console.log(`[ValueMonitor] [${level.toUpperCase()}] ${message}`);
}

// ─── HTTP Fetch Helper ─────────────────────────────────────
function fetchUrl(url, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
        
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            timeout: 30000,
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const redirectUrl = new URL(res.headers.location, url).href;
                return fetchUrl(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
            }
            
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    });
}

// ─── County-Specific Value Parsers ─────────────────────────

/**
 * Parse FBCAD property page for 2026 values.
 * FBCAD uses True Automation's esearch platform.
 * The "Property Roll Value History" table shows year-by-year values.
 * When 2026 values are posted, the row will show actual numbers instead of "N/A".
 */
function parseFBCADValues(html, taxYear = 2026) {
    const result = {
        found: false,
        taxYear,
        marketValue: null,
        appraisedValue: null,
        landValue: null,
        improvementValue: null,
        raw: null,
    };

    // Check if the page loaded successfully
    if (!html || html.includes('No records found') || html.includes('404')) {
        result.error = 'Property page not found or empty';
        return result;
    }

    // IMPORTANT: Check for N/A FIRST to avoid false positives.
    // The Roll Value History table shows rows like:
    //   2026  N/A  N/A  N/A  N/A  N/A
    //   2025  $585,736  $63,050  $0  $0  $648,786
    // A greedy regex for "2026...$(number)" would skip past N/A and grab 2025 values.
    
    // Method 1: Check if the target year row shows N/A (values not yet posted)
    // Match the year followed by N/A within a short window (before hitting another year)
    const naPattern = new RegExp(`(?:^|\\n|>)\\s*${taxYear}\\b[^\\d$]*N/A`, 'im');
    if (naPattern.test(html)) {
        result.found = false;
        result.raw = `${taxYear} row found but values show N/A — not yet posted`;
        return result;
    }

    // Method 2: Check the Roll Value History table for actual dollar values on the target year row.
    // We need to ensure the dollar values are between "2026" and the NEXT year row (e.g., "2025").
    // Extract the text segment between the target year and the next year.
    const nextYear = taxYear - 1;
    const rowPattern = new RegExp(
        `${taxYear}([\\s\\S]*?)(?:${nextYear}|$)`,
        'i'
    );
    const rowMatch = html.match(rowPattern);
    
    if (rowMatch) {
        const rowContent = rowMatch[1];
        // Now look for dollar amounts ONLY within this year's row
        const dollarValues = [];
        const dollarRegex = /\$([\d,]+(?:\.\d+)?)/g;
        let m;
        while ((m = dollarRegex.exec(rowContent)) !== null) {
            dollarValues.push(parseInt(m[1].replace(/[,$]/g, ''), 10));
        }
        
        // Roll Value History format: Improvements | Land Market | Ag Valuation | HS Cap Loss | Appraised
        if (dollarValues.length >= 5) {
            result.found = true;
            result.improvementValue = dollarValues[0];
            result.landValue = dollarValues[1];
            result.appraisedValue = dollarValues[4];
            result.marketValue = result.appraisedValue;
            result.raw = `Roll History: improvements=$${dollarValues[0].toLocaleString()}, land=$${dollarValues[1].toLocaleString()}, appraised=$${dollarValues[4].toLocaleString()}`;
            return result;
        }
        
        // If we found the row but no dollar values, it's truly N/A
        if (dollarValues.length === 0) {
            result.found = false;
            result.raw = `${taxYear} row found but no dollar values — not yet posted`;
            return result;
        }
    }

    // Method 3: Check the main "Property Values" section if it shows the target year
    // This catches cases where the page layout shows current-year values prominently
    const yearIndicator = new RegExp(`${taxYear}\\s*(appraisal|tax|certified|values)`, 'i');
    if (yearIndicator.test(html)) {
        const mainValuePattern = /Market\s*Value[:\s]*\$?([\d,]+)/i;
        const mainMatch = html.match(mainValuePattern);
        
        if (mainMatch) {
            const parseVal = (s) => parseInt(s.replace(/[,$]/g, ''), 10);
            result.found = true;
            result.marketValue = parseVal(mainMatch[1]);
            
            const appraisedMatch = html.match(/Appraised\s*Value[:\s]*\$?([\d,]+)/i);
            if (appraisedMatch) result.appraisedValue = parseVal(appraisedMatch[1]);
            
            result.raw = mainMatch[0].substring(0, 200);
            return result;
        }
    }

    result.raw = `Could not determine ${taxYear} value status from page content`;
    return result;
}

/**
 * Parse Collin CAD property page for values.
 * Collin CAD also uses a True Automation-style esearch platform.
 */
function parseCollinCADValues(html, taxYear = 2026) {
    // Collin CAD uses similar structure to FBCAD
    return parseGenericTrueAutomationValues(html, taxYear);
}

/**
 * Generic parser for True Automation esearch platforms (used by many TX counties).
 */
function parseGenericTrueAutomationValues(html, taxYear = 2026) {
    const result = {
        found: false,
        taxYear,
        marketValue: null,
        appraisedValue: null,
        landValue: null,
        improvementValue: null,
        raw: null,
    };

    if (!html || html.includes('No records found')) {
        result.error = 'Property page not found or empty';
        return result;
    }

    // Check for N/A FIRST to avoid false positives
    const naPattern = new RegExp(`(?:^|\\n|>)\\s*${taxYear}\\b[^\\d$]*N/A`, 'im');
    if (naPattern.test(html)) {
        result.found = false;
        result.raw = `${taxYear} row found but values show N/A`;
        return result;
    }

    // Extract the row segment between target year and next year
    const nextYear = taxYear - 1;
    const rowPattern = new RegExp(`${taxYear}([\\s\\S]*?)(?:${nextYear}|$)`, 'i');
    const rowMatch = html.match(rowPattern);
    
    if (rowMatch) {
        const rowContent = rowMatch[1];
        const dollarValues = [];
        const dollarRegex = /\$([\d,]+(?:\.\d+)?)/g;
        let m;
        while ((m = dollarRegex.exec(rowContent)) !== null) {
            dollarValues.push(parseInt(m[1].replace(/[,$]/g, ''), 10));
        }
        
        if (dollarValues.length >= 5) {
            result.found = true;
            result.improvementValue = dollarValues[0];
            result.landValue = dollarValues[1];
            result.appraisedValue = dollarValues[4];
            result.marketValue = result.appraisedValue;
            result.raw = `Roll History: appraised=$${dollarValues[4].toLocaleString()}`;
            return result;
        }
        
        if (dollarValues.length === 0) {
            result.found = false;
            result.raw = `${taxYear} row found but no dollar values`;
            return result;
        }
    }

    result.raw = `Could not find ${taxYear} values in page content`;
    return result;
}

// ─── Client Fetching ───────────────────────────────────────

/**
 * Get all active clients that need monitoring from Supabase.
 * Active = status is "Form Signed" and has a county we support.
 */
async function getActiveClients() {
    if (!isSupabaseEnabled()) {
        console.log('[ValueMonitor] Supabase not enabled, using hardcoded client list');
        return getHardcodedClients();
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('submissions')
            .select('case_id, owner_name, property_address, county, pin, assessed_value, email, phone, status, signature, filing_data')
            .in('status', ['Form Signed', 'Analysis Complete', 'Ready to File'])
            .not('signature', 'is', null);

        if (error) throw error;

        return (data || []).map(row => ({
            caseId: row.case_id,
            ownerName: row.owner_name,
            propertyAddress: row.property_address,
            county: row.county,
            accountId: row.pin || null,
            assessedValue2025: parseInt(String(row.assessed_value).replace(/[^0-9]/g, ''), 10) || 0,
            email: row.email,
            phone: row.phone,
            status: row.status,
            hasSigned: !!(row.signature && row.signature.authorized),
            filingData: row.filing_data,
        }));
    } catch (err) {
        console.error('[ValueMonitor] Error fetching clients from Supabase:', err.message);
        return getHardcodedClients();
    }
}

/**
 * Fallback hardcoded clients (for when Supabase is unavailable).
 */
function getHardcodedClients() {
    return [
        {
            caseId: 'OA-0010',
            ownerName: 'Khiem Nguyen',
            propertyAddress: '3315 Marlene Meadow Way, Richmond, TX 77406',
            county: 'Fort Bend',
            accountId: 'R523440',
            assessedValue2025: 648786,
            email: null, // Will be fetched from Supabase when available
            phone: null,
            status: 'Form Signed',
            hasSigned: true,
        },
    ];
}

// ─── Core Monitor Logic ────────────────────────────────────

/**
 * Check a single client's property for 2026 values.
 */
async function checkClient(client, state) {
    const county = client.county;
    const config = COUNTY_CONFIGS[county];
    
    if (!config) {
        addLogEntry(state, `No county config for "${county}" (${client.caseId})`, 'warn');
        return { checked: false, reason: `Unsupported county: ${county}` };
    }

    if (!client.accountId) {
        addLogEntry(state, `No account ID for ${client.caseId} (${county}) — skipping value check`, 'warn');
        return { checked: false, reason: 'No account ID (PIN) on file' };
    }

    const url = config.propertyUrl(client.accountId);
    addLogEntry(state, `Checking ${client.caseId} (${client.ownerName}) at ${url}`);

    try {
        const { statusCode, body } = await fetchUrl(url);
        
        if (statusCode !== 200) {
            addLogEntry(state, `HTTP ${statusCode} for ${client.caseId} at ${url}`, 'warn');
            return { checked: true, found: false, error: `HTTP ${statusCode}` };
        }

        const values = config.parseValues(body, 2026);
        
        // Update client state
        if (!state.clients[client.caseId]) {
            state.clients[client.caseId] = {
                county,
                accountId: client.accountId,
                ownerName: client.ownerName,
                checks: [],
            };
        }
        
        const clientState = state.clients[client.caseId];
        clientState.lastChecked = new Date().toISOString();
        clientState.checks.push({
            timestamp: new Date().toISOString(),
            found: values.found,
            value: values.appraisedValue,
            raw: values.raw,
        });
        
        // Keep last 30 check entries per client
        if (clientState.checks.length > 30) {
            clientState.checks = clientState.checks.slice(-30);
        }

        if (values.found) {
            addLogEntry(state, `🚨 2026 VALUES DETECTED for ${client.caseId}: Appraised=$${values.appraisedValue?.toLocaleString()}`, 'alert');
            clientState.value2026Detected = true;
            clientState.value2026 = values.appraisedValue;
            clientState.detectedAt = new Date().toISOString();
            
            return {
                checked: true,
                found: true,
                values,
                client,
            };
        } else {
            addLogEntry(state, `No 2026 values yet for ${client.caseId}: ${values.raw || 'N/A'}`);
            return { checked: true, found: false, raw: values.raw };
        }

    } catch (err) {
        addLogEntry(state, `Error checking ${client.caseId}: ${err.message}`, 'error');
        return { checked: true, found: false, error: err.message };
    }
}

// ─── Notification Helpers ──────────────────────────────────

async function sendSMS(to, message) {
    try {
        const twilio = require('twilio');
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        
        const formattedTo = to.startsWith('+') ? to : `+1${to.replace(/\D/g, '')}`;
        
        const msgOpts = { body: message, to: formattedTo };
        if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
            msgOpts.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
        } else {
            msgOpts.from = process.env.TWILIO_SMS_NUMBER || process.env.TWILIO_PHONE_NUMBER;
        }
        await client.messages.create(msgOpts);
        console.log(`[ValueMonitor] SMS sent to ${formattedTo}`);
    } catch (err) {
        console.error(`[ValueMonitor] SMS error: ${err.message}`);
    }
}

async function sendEmail(to, subject, htmlBody) {
    try {
        const sgMail = require('@sendgrid/mail');
        if (!process.env.SENDGRID_API_KEY) {
            console.log('[ValueMonitor] No SendGrid key, skipping email');
            return;
        }
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);
        
        await sgMail.send({
            to,
            from: { email: process.env.SENDGRID_FROM_EMAIL || 'notifications@overassessed.ai', name: 'OverAssessed' },
            subject,
            html: htmlBody,
        });
        console.log(`[ValueMonitor] Email sent to ${to}`);
    } catch (err) {
        console.error(`[ValueMonitor] Email error: ${err.message}`);
    }
}

/**
 * Notify Tyler when 2026 values are detected.
 */
async function notifyTyler(client, values) {
    const change = values.appraisedValue - client.assessedValue2025;
    const changePct = client.assessedValue2025 > 0 
        ? ((change / client.assessedValue2025) * 100).toFixed(1) 
        : 'N/A';
    const direction = change > 0 ? '📈 UP' : change < 0 ? '📉 DOWN' : '➡️ SAME';
    
    const smsMsg = `🚨 2026 VALUES POSTED!\n\n` +
        `${client.ownerName} (${client.caseId})\n` +
        `${client.county} County\n` +
        `2025: $${client.assessedValue2025.toLocaleString()}\n` +
        `2026: $${values.appraisedValue.toLocaleString()}\n` +
        `Change: ${direction} ${changePct}%\n\n` +
        `${client.hasSigned ? '✅ Form signed — ready to file!' : '⚠️ Form NOT signed yet'}`;

    const emailHtml = `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
            <div style="background:linear-gradient(135deg,#e74c3c,#c0392b);padding:1.5rem;text-align:center;border-radius:12px 12px 0 0;">
                <h1 style="color:white;margin:0;">🚨 2026 Values Detected!</h1>
            </div>
            <div style="padding:1.5rem;background:white;border:1px solid #eee;border-radius:0 0 12px 12px;">
                <table style="width:100%;border-collapse:collapse;">
                    <tr><td style="padding:8px;font-weight:bold;">Client:</td><td style="padding:8px;">${client.ownerName} (${client.caseId})</td></tr>
                    <tr><td style="padding:8px;font-weight:bold;">Property:</td><td style="padding:8px;">${client.propertyAddress}</td></tr>
                    <tr><td style="padding:8px;font-weight:bold;">County:</td><td style="padding:8px;">${client.county}</td></tr>
                    <tr><td style="padding:8px;font-weight:bold;">2025 Value:</td><td style="padding:8px;">$${client.assessedValue2025.toLocaleString()}</td></tr>
                    <tr><td style="padding:8px;font-weight:bold;">2026 Value:</td><td style="padding:8px;color:#e74c3c;font-weight:bold;">$${values.appraisedValue.toLocaleString()}</td></tr>
                    <tr><td style="padding:8px;font-weight:bold;">Change:</td><td style="padding:8px;">${direction} ${changePct}% ($${Math.abs(change).toLocaleString()})</td></tr>
                    <tr><td style="padding:8px;font-weight:bold;">Form Signed:</td><td style="padding:8px;">${client.hasSigned ? '✅ Yes' : '❌ No'}</td></tr>
                </table>
                ${client.hasSigned ? '<p style="background:#2ecc71;color:white;padding:12px;border-radius:8px;text-align:center;font-weight:bold;">Ready to file protest — auto-filing will be triggered!</p>' : '<p style="background:#f39c12;color:white;padding:12px;border-radius:8px;text-align:center;font-weight:bold;">⚠️ Form not signed yet — cannot auto-file.</p>'}
                <hr style="border:none;border-top:1px solid #eee;margin:1rem 0;">
                <p style="font-size:0.8rem;color:#999;text-align:center;">OverAssessed Value Monitor</p>
            </div>
        </div>`;

    await Promise.all([
        sendSMS(TYLER_PHONE, smsMsg),
        sendEmail(TYLER_EMAIL, `🚨 2026 Values Posted — ${client.ownerName} (${client.county})`, emailHtml),
    ]);
}

/**
 * Update Supabase when 2026 values are detected.
 */
async function updateSupabase(client, values) {
    if (!isSupabaseEnabled()) return;

    try {
        const updateData = {
            status: 'Ready to File',
            notes: `2026 appraised value detected: $${values.appraisedValue.toLocaleString()} (was $${client.assessedValue2025.toLocaleString()} in 2025). Detected ${new Date().toISOString()}.`,
            filing_data: {
                ...(client.filingData || {}),
                value2026: values.appraisedValue,
                value2025: client.assessedValue2025,
                valueChange: values.appraisedValue - client.assessedValue2025,
                valueChangePercent: client.assessedValue2025 > 0 
                    ? ((values.appraisedValue - client.assessedValue2025) / client.assessedValue2025 * 100).toFixed(1) + '%'
                    : 'N/A',
                detectedAt: new Date().toISOString(),
                autoFileTriggered: client.hasSigned,
            },
            updated_at: new Date().toISOString(),
        };

        const { error } = await supabaseAdmin
            .from('submissions')
            .update(updateData)
            .eq('case_id', client.caseId);

        if (error) throw error;
        console.log(`[ValueMonitor] Updated Supabase for ${client.caseId}`);
    } catch (err) {
        console.error(`[ValueMonitor] Supabase update error for ${client.caseId}:`, err.message);
    }
}

// ─── Main Monitor Run ──────────────────────────────────────

/**
 * Run the value monitor for all active clients.
 * Returns a summary of what was found.
 */
async function runMonitor() {
    console.log('\n' + '='.repeat(60));
    console.log('[ValueMonitor] Starting value monitoring run...');
    console.log(`[ValueMonitor] Time: ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })}`);
    console.log('='.repeat(60));

    const state = loadState();
    state.lastRun = new Date().toISOString();
    
    const clients = await getActiveClients();
    addLogEntry(state, `Found ${clients.length} active client(s) to check`);
    
    const results = {
        totalChecked: 0,
        valuesFound: [],
        errors: [],
        skipped: [],
    };

    for (const client of clients) {
        try {
            const result = await checkClient(client, state);
            
            if (!result.checked) {
                results.skipped.push({ caseId: client.caseId, reason: result.reason });
                continue;
            }
            
            results.totalChecked++;
            
            if (result.found) {
                results.valuesFound.push({
                    caseId: client.caseId,
                    ownerName: client.ownerName,
                    county: client.county,
                    value2026: result.values.appraisedValue,
                    value2025: client.assessedValue2025,
                });

                // Notify Tyler
                await notifyTyler(client, result.values);
                
                // Update Supabase
                await updateSupabase(client, result.values);

                // Trigger auto-filing if form is signed and county supports eFile
                const countyConfig = COUNTY_CONFIGS[client.county];
                if (client.hasSigned && countyConfig && countyConfig.supportsEfile) {
                    addLogEntry(state, `Triggering auto-file for ${client.caseId} (${client.county} eFile)`, 'alert');
                    state.clients[client.caseId].autoFileTriggered = true;
                    state.clients[client.caseId].autoFileTriggerTime = new Date().toISOString();
                    
                    // Auto-file will be handled by auto-file.js
                    // For now, just mark it as ready
                    try {
                        const autoFile = require('./auto-file');
                        if (autoFile.fileFBCADProtest) {
                            // Don't await — let it run async
                            autoFile.fileFBCADProtest(client).catch(err => {
                                console.error(`[ValueMonitor] Auto-file error for ${client.caseId}:`, err.message);
                            });
                        }
                    } catch (err) {
                        addLogEntry(state, `Could not trigger auto-file: ${err.message}`, 'warn');
                    }
                }
            }
            
            if (result.error) {
                results.errors.push({ caseId: client.caseId, error: result.error });
            }

            // Brief delay between checks to be polite to CAD servers
            await new Promise(resolve => setTimeout(resolve, 2000));
            
        } catch (err) {
            results.errors.push({ caseId: client.caseId, error: err.message });
            addLogEntry(state, `Unexpected error for ${client.caseId}: ${err.message}`, 'error');
        }
    }

    // Save state
    saveState(state);

    // Summary
    console.log('\n' + '-'.repeat(60));
    console.log('[ValueMonitor] Run complete:');
    console.log(`  Checked: ${results.totalChecked}`);
    console.log(`  Values found: ${results.valuesFound.length}`);
    console.log(`  Skipped: ${results.skipped.length}`);
    console.log(`  Errors: ${results.errors.length}`);
    
    if (results.valuesFound.length > 0) {
        console.log('\n  🚨 NEW VALUES DETECTED:');
        results.valuesFound.forEach(v => {
            console.log(`    ${v.caseId} (${v.ownerName}): $${v.value2025.toLocaleString()} → $${v.value2026.toLocaleString()}`);
        });
    }
    
    if (results.skipped.length > 0) {
        console.log('\n  ⏭️ SKIPPED:');
        results.skipped.forEach(s => {
            console.log(`    ${s.caseId}: ${s.reason}`);
        });
    }
    
    if (results.errors.length > 0) {
        console.log('\n  ❌ ERRORS:');
        results.errors.forEach(e => {
            console.log(`    ${e.caseId}: ${e.error}`);
        });
    }

    console.log('-'.repeat(60) + '\n');
    
    return results;
}

// ─── CLI Entry Point ───────────────────────────────────────
if (require.main === module) {
    runMonitor()
        .then(results => {
            console.log('[ValueMonitor] Done.');
            process.exit(0);
        })
        .catch(err => {
            console.error('[ValueMonitor] Fatal error:', err);
            process.exit(1);
        });
}

module.exports = {
    runMonitor,
    checkClient,
    getActiveClients,
    loadState,
    saveState,
    COUNTY_CONFIGS,
    parseFBCADValues,
    parseCollinCADValues,
    parseGenericTrueAutomationValues,
};
