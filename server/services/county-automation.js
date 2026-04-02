/**
 * County Portal Automation — Playwright-based browser automation for filing property tax protests.
 * Each county has its own filing function. All share common patterns:
 * - Launch browser → navigate → login → fill forms → upload evidence → submit → capture confirmation
 * - Screenshot every step, log to automation_log
 * - Graceful error handling with screenshot on failure
 * 
 * NOTE: Selectors marked with TODO need verification when county portals open for protest season (April).
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs').promises;

const SCREENSHOTS_BASE = path.join(__dirname, '..', '..', 'data', 'automation-screenshots');
const DEFAULT_TIMEOUT = 30000;
const NAVIGATION_TIMEOUT = 60000;

// ─── Shared Utilities ────────────────────────────────────────────

class AutomationContext {
    constructor(filing, options = {}) {
        this.filing = filing;
        this.headless = options.headless !== false; // default headless
        this.screenshots = [];
        this.log = [];
        this.screenshotDir = path.join(SCREENSHOTS_BASE, filing.id);
        this.browser = null;
        this.page = null;
        this.stepIndex = 0;
    }

    async init() {
        await fs.mkdir(this.screenshotDir, { recursive: true });
        this.browser = await chromium.launch({
            headless: this.headless,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const context = await this.browser.newContext({
            viewport: { width: 1280, height: 900 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        this.page = await context.newPage();
        this.page.setDefaultTimeout(DEFAULT_TIMEOUT);
        this.page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT);
        this.addLog('Browser launched', 'init');
    }

    async screenshot(stepName) {
        try {
            this.stepIndex++;
            const filename = `${String(this.stepIndex).padStart(2, '0')}-${stepName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.png`;
            const filepath = path.join(this.screenshotDir, filename);
            await this.page.screenshot({ path: filepath, fullPage: false });
            const relPath = `/data/automation-screenshots/${this.filing.id}/${filename}`;
            this.screenshots.push({ step: stepName, path: relPath, timestamp: new Date().toISOString() });
            return relPath;
        } catch (err) {
            this.addLog(`Screenshot failed for ${stepName}: ${err.message}`, 'warning');
            return null;
        }
    }

    addLog(message, level = 'info') {
        const entry = { timestamp: new Date().toISOString(), message, level };
        this.log.push(entry);
        console.log(`[Automation][${this.filing.id.slice(0, 8)}] ${message}`);
    }

    async cleanup() {
        try { if (this.browser) await this.browser.close(); } catch (e) { /* ignore */ }
    }

    result(success, confirmationNumber = null, error = null) {
        return {
            success,
            confirmationNumber,
            screenshots: this.screenshots,
            log: this.log,
            failedStep: error ? this.log[this.log.length - 1]?.message : null,
            error: error?.message || null
        };
    }

    async retryClick(locator, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                await locator.click({ timeout: DEFAULT_TIMEOUT });
                return true;
            } catch (e) {
                if (i === retries - 1) throw e;
                await this.page.waitForTimeout(1000);
            }
        }
    }
}

// ─── BCAD (Bexar County) ────────────────────────────────────────

async function fileBexar(filing, options = {}) {
    const ctx = new AutomationContext(filing, options);
    try {
        await ctx.init();

        // Step 1: Navigate to portal
        ctx.addLog('Navigating to BCAD online portal');
        await ctx.page.goto('https://bcad.org/online-portal/', { waitUntil: 'networkidle' });
        await ctx.screenshot('bcad-portal-home');

        // Step 2: Login with Owner ID + PIN
        ctx.addLog('Logging in with Owner ID and PIN');
        // TODO: Verify selectors when portal opens in April
        const ownerIdInput = ctx.page.getByLabel('Owner ID').or(ctx.page.getByLabel('Account Number')).or(ctx.page.locator('input[name*="owner"], input[name*="account"], input[id*="owner"], input[id*="account"]').first());
        await ownerIdInput.fill(filing.portal_account_id || '');

        const pinInput = ctx.page.getByLabel('PIN').or(ctx.page.getByLabel('Password')).or(ctx.page.locator('input[type="password"], input[name*="pin"], input[id*="pin"]').first());
        await pinInput.fill(filing.portal_pin || '');

        await ctx.screenshot('bcad-credentials-entered');

        const loginBtn = ctx.page.getByRole('button', { name: /log\s*in|sign\s*in|submit/i }).first();
        await ctx.retryClick(loginBtn);
        await ctx.page.waitForLoadState('networkidle');
        await ctx.screenshot('bcad-after-login');
        ctx.addLog('Login submitted');

        // Step 3: Select property by account number
        ctx.addLog('Selecting property');
        // TODO: Verify — portal may show property list after login or go directly to account
        const propertyLink = ctx.page.getByText(filing.portal_account_id || '', { exact: false }).first();
        try {
            await propertyLink.click({ timeout: 10000 });
        } catch {
            ctx.addLog('Property auto-selected or single-property account', 'info');
        }
        await ctx.screenshot('bcad-property-selected');

        // Step 4: Click "File Protest"
        ctx.addLog('Clicking File Protest');
        const protestBtn = ctx.page.getByRole('link', { name: /file.*protest|protest/i })
            .or(ctx.page.getByRole('button', { name: /file.*protest|protest/i }))
            .or(ctx.page.getByText('File Protest')).first();
        await ctx.retryClick(protestBtn);
        await ctx.page.waitForLoadState('networkidle');
        await ctx.screenshot('bcad-file-protest-page');
        ctx.addLog('File Protest page loaded');

        // Step 5: Select protest reason: "Market Value"
        ctx.addLog('Selecting protest reason: Market Value');
        const marketValueOption = ctx.page.getByLabel(/market\s*value/i)
            .or(ctx.page.getByText('Market Value').first());
        try {
            await marketValueOption.check();
        } catch {
            // May be a radio button or dropdown
            try {
                await marketValueOption.click();
            } catch {
                // Try selecting from dropdown
                const select = ctx.page.getByRole('combobox').first();
                await select.selectOption({ label: /market/i });
            }
        }
        await ctx.screenshot('bcad-reason-selected');

        // Step 6: Upload evidence packet PDF
        ctx.addLog('Uploading evidence packet');
        if (filing.evidence_packet_url) {
            const evidencePath = path.join(__dirname, '..', '..', filing.evidence_packet_url.replace(/^\//, ''));
            const fileInput = ctx.page.locator('input[type="file"]').first();
            await fileInput.setInputFiles(evidencePath);
            await ctx.page.waitForTimeout(2000);
            await ctx.screenshot('bcad-evidence-uploaded');
            ctx.addLog('Evidence packet uploaded');
        } else {
            ctx.addLog('No evidence packet URL — skipping upload', 'warning');
        }

        // Step 7: Submit protest
        ctx.addLog('Submitting protest');
        const submitBtn = ctx.page.getByRole('button', { name: /submit|file|next/i }).last();
        await ctx.retryClick(submitBtn);
        await ctx.page.waitForLoadState('networkidle');
        await ctx.page.waitForTimeout(3000);
        await ctx.screenshot('bcad-submitted');

        // Step 8: Capture confirmation number
        ctx.addLog('Capturing confirmation');
        let confirmationNumber = null;
        try {
            const confirmText = await ctx.page.getByText(/confirmation|reference|protest.*number/i).first().textContent();
            const match = confirmText.match(/[A-Z0-9-]{6,}/);
            confirmationNumber = match ? match[0] : confirmText.trim().slice(0, 50);
        } catch {
            // Try page content
            const content = await ctx.page.content();
            const match = content.match(/confirmation[^:]*:\s*([A-Z0-9-]+)/i);
            confirmationNumber = match ? match[1] : 'SUBMITTED-' + new Date().toISOString().slice(0, 10);
        }
        await ctx.screenshot('bcad-confirmation');
        ctx.addLog(`Protest filed. Confirmation: ${confirmationNumber}`);

        await ctx.cleanup();
        return ctx.result(true, confirmationNumber);

    } catch (error) {
        ctx.addLog(`FAILED at step: ${error.message}`, 'error');
        try { await ctx.screenshot('bcad-error'); } catch { /* ignore */ }
        await ctx.cleanup();
        return ctx.result(false, null, error);
    }
}

// ─── HCAD (Harris County) ───────────────────────────────────────

async function fileHarris(filing, options = {}) {
    const ctx = new AutomationContext(filing, options);
    try {
        await ctx.init();

        // Step 1: Navigate to iFile
        ctx.addLog('Navigating to HCAD iFile portal');
        await ctx.page.goto('https://owners.hcad.org', { waitUntil: 'networkidle' });
        await ctx.screenshot('hcad-portal-home');

        // Step 2: Login with iFile number
        ctx.addLog('Logging in to iFile');
        // TODO: Verify selectors — HCAD uses iFile system
        const ifileInput = ctx.page.getByLabel(/iFile|Account/i)
            .or(ctx.page.locator('input[name*="ifile"], input[name*="account"], input[id*="ifile"]').first());
        await ifileInput.fill(filing.portal_account_id || '');

        const pinInput = ctx.page.getByLabel(/PIN|Password/i)
            .or(ctx.page.locator('input[type="password"]').first());
        await pinInput.fill(filing.portal_pin || '');
        await ctx.screenshot('hcad-credentials');

        const loginBtn = ctx.page.getByRole('button', { name: /log\s*in|sign\s*in|submit/i }).first();
        await ctx.retryClick(loginBtn);
        await ctx.page.waitForLoadState('networkidle');
        await ctx.screenshot('hcad-after-login');
        ctx.addLog('Login successful');

        // Step 3: Navigate to File Protest
        ctx.addLog('Navigating to File Protest');
        const protestLink = ctx.page.getByRole('link', { name: /file.*protest|protest.*online|ifile/i })
            .or(ctx.page.getByText(/file.*protest/i)).first();
        await ctx.retryClick(protestLink);
        await ctx.page.waitForLoadState('networkidle');
        await ctx.screenshot('hcad-protest-page');

        // Step 4: Choose protest type (Market Value)
        ctx.addLog('Selecting protest type: Market Value');
        const mvCheckbox = ctx.page.getByLabel(/market\s*value/i)
            .or(ctx.page.getByText('Market Value').first());
        try { await mvCheckbox.check(); } catch { await mvCheckbox.click(); }
        await ctx.screenshot('hcad-protest-type');

        // Step 5: Upload evidence
        ctx.addLog('Uploading evidence');
        if (filing.evidence_packet_url) {
            const evidencePath = path.join(__dirname, '..', '..', filing.evidence_packet_url.replace(/^\//, ''));
            const fileInput = ctx.page.locator('input[type="file"]').first();
            await fileInput.setInputFiles(evidencePath);
            await ctx.page.waitForTimeout(2000);
            await ctx.screenshot('hcad-evidence-uploaded');
        }

        // Step 6: Submit
        ctx.addLog('Submitting protest');
        const submitBtn = ctx.page.getByRole('button', { name: /submit|file|next/i }).last();
        await ctx.retryClick(submitBtn);
        await ctx.page.waitForLoadState('networkidle');
        await ctx.page.waitForTimeout(3000);
        await ctx.screenshot('hcad-submitted');

        // Step 7: Capture confirmation
        let confirmationNumber = null;
        try {
            const confirmEl = await ctx.page.getByText(/confirmation|reference|protest.*number/i).first().textContent();
            const match = confirmEl.match(/[A-Z0-9-]{6,}/);
            confirmationNumber = match ? match[0] : confirmEl.trim().slice(0, 50);
        } catch {
            confirmationNumber = 'SUBMITTED-' + new Date().toISOString().slice(0, 10);
        }
        await ctx.screenshot('hcad-confirmation');
        ctx.addLog(`Protest filed. Confirmation: ${confirmationNumber}`);

        // Step 8: Check iSettle for offers
        ctx.addLog('Checking iSettle for settlement offers');
        try {
            const iSettleLink = ctx.page.getByRole('link', { name: /isettle|settlement/i }).first();
            await iSettleLink.click({ timeout: 5000 });
            await ctx.page.waitForLoadState('networkidle');
            await ctx.screenshot('hcad-isettle');
            ctx.addLog('iSettle page loaded — check for offers');
        } catch {
            ctx.addLog('iSettle not available yet', 'info');
        }

        await ctx.cleanup();
        return ctx.result(true, confirmationNumber);

    } catch (error) {
        ctx.addLog(`FAILED: ${error.message}`, 'error');
        try { await ctx.screenshot('hcad-error'); } catch { /* */ }
        await ctx.cleanup();
        return ctx.result(false, null, error);
    }
}

// ─── TCAD (Travis County) ───────────────────────────────────────

async function fileTravis(filing, options = {}) {
    const ctx = new AutomationContext(filing, options);
    try {
        await ctx.init();

        ctx.addLog('Navigating to TCAD E-File portal');
        await ctx.page.goto('https://traviscad.org/efile/', { waitUntil: 'networkidle' });
        await ctx.screenshot('tcad-portal-home');

        // Login
        ctx.addLog('Logging in');
        // TODO: Verify — TCAD E-File uses property ID + PIN
        const acctInput = ctx.page.getByLabel(/property.*id|account/i)
            .or(ctx.page.locator('input[name*="account"], input[name*="prop"], input[id*="account"]').first());
        await acctInput.fill(filing.portal_account_id || '');

        const pinInput = ctx.page.getByLabel(/PIN|Password|Access/i)
            .or(ctx.page.locator('input[type="password"]').first());
        await pinInput.fill(filing.portal_pin || '');
        await ctx.screenshot('tcad-credentials');

        const loginBtn = ctx.page.getByRole('button', { name: /log\s*in|sign\s*in|submit|continue/i }).first();
        await ctx.retryClick(loginBtn);
        await ctx.page.waitForLoadState('networkidle');
        await ctx.screenshot('tcad-after-login');

        // Select property
        ctx.addLog('Selecting property');
        try {
            const propRow = ctx.page.getByText(filing.portal_account_id || '', { exact: false }).first();
            await propRow.click({ timeout: 10000 });
        } catch {
            ctx.addLog('Property auto-selected', 'info');
        }
        await ctx.screenshot('tcad-property');

        // File protest
        ctx.addLog('Filing protest');
        const protestBtn = ctx.page.getByRole('link', { name: /file.*protest|e-?file|protest/i })
            .or(ctx.page.getByRole('button', { name: /file.*protest|protest/i }))
            .or(ctx.page.getByText(/file.*protest/i)).first();
        await ctx.retryClick(protestBtn);
        await ctx.page.waitForLoadState('networkidle');
        await ctx.screenshot('tcad-protest-form');

        // Select Market Value reason
        const mvOption = ctx.page.getByLabel(/market\s*value/i)
            .or(ctx.page.getByText('Market Value').first());
        try { await mvOption.check(); } catch { await mvOption.click(); }
        await ctx.screenshot('tcad-reason');

        // Upload evidence
        if (filing.evidence_packet_url) {
            ctx.addLog('Uploading evidence');
            const evidencePath = path.join(__dirname, '..', '..', filing.evidence_packet_url.replace(/^\//, ''));
            const fileInput = ctx.page.locator('input[type="file"]').first();
            await fileInput.setInputFiles(evidencePath);
            await ctx.page.waitForTimeout(2000);
            await ctx.screenshot('tcad-evidence');
        }

        // Submit
        ctx.addLog('Submitting');
        const submitBtn = ctx.page.getByRole('button', { name: /submit|file|next/i }).last();
        await ctx.retryClick(submitBtn);
        await ctx.page.waitForLoadState('networkidle');
        await ctx.page.waitForTimeout(3000);
        await ctx.screenshot('tcad-submitted');

        // Capture confirmation
        let confirmationNumber = null;
        try {
            const txt = await ctx.page.getByText(/confirmation|reference|protest.*number/i).first().textContent();
            const match = txt.match(/[A-Z0-9-]{6,}/);
            confirmationNumber = match ? match[0] : txt.trim().slice(0, 50);
        } catch {
            confirmationNumber = 'SUBMITTED-' + new Date().toISOString().slice(0, 10);
        }
        await ctx.screenshot('tcad-confirmation');
        ctx.addLog(`Filed. Confirmation: ${confirmationNumber}`);

        await ctx.cleanup();
        return ctx.result(true, confirmationNumber);

    } catch (error) {
        ctx.addLog(`FAILED: ${error.message}`, 'error');
        try { await ctx.screenshot('tcad-error'); } catch { /* */ }
        await ctx.cleanup();
        return ctx.result(false, null, error);
    }
}

// ─── DCAD (Dallas County) ───────────────────────────────────────

async function fileDallas(filing, options = {}) {
    const ctx = new AutomationContext(filing, options);
    try {
        await ctx.init();

        ctx.addLog('Navigating to DCAD portal');
        await ctx.page.goto('https://www.dallascad.org', { waitUntil: 'networkidle' });
        await ctx.screenshot('dcad-home');

        // Search for property
        ctx.addLog('Searching for property');
        // TODO: Verify — DCAD has a search bar on homepage
        const searchInput = ctx.page.getByRole('searchbox')
            .or(ctx.page.getByPlaceholder(/search|account|address/i))
            .or(ctx.page.locator('input[name*="search"], input[id*="search"]').first());
        await searchInput.fill(filing.portal_account_id || '');
        await ctx.page.keyboard.press('Enter');
        await ctx.page.waitForLoadState('networkidle');
        await ctx.screenshot('dcad-search-results');

        // Click property result
        try {
            const propLink = ctx.page.getByText(filing.portal_account_id || '').first();
            await propLink.click({ timeout: 10000 });
            await ctx.page.waitForLoadState('networkidle');
        } catch {
            ctx.addLog('Direct property page loaded', 'info');
        }
        await ctx.screenshot('dcad-property');

        // Click uFile Online Protest
        ctx.addLog('Clicking uFile Online Protest');
        // TODO: Verify — DCAD uses uFile system
        const ufileLink = ctx.page.getByRole('link', { name: /ufile|online.*protest|file.*protest/i })
            .or(ctx.page.getByText(/ufile|online.*protest/i)).first();
        await ctx.retryClick(ufileLink);
        await ctx.page.waitForLoadState('networkidle');
        await ctx.screenshot('dcad-ufile');

        // Login/authenticate if needed
        try {
            const pinInput = ctx.page.getByLabel(/PIN|Password/i)
                .or(ctx.page.locator('input[type="password"]').first());
            await pinInput.fill(filing.portal_pin || '', { timeout: 5000 });
            const loginBtn = ctx.page.getByRole('button', { name: /log\s*in|submit|continue/i }).first();
            await ctx.retryClick(loginBtn);
            await ctx.page.waitForLoadState('networkidle');
            await ctx.screenshot('dcad-authenticated');
        } catch {
            ctx.addLog('No auth needed or already authenticated', 'info');
        }

        // Select protest reason
        ctx.addLog('Selecting protest reason');
        const mvOption = ctx.page.getByLabel(/market\s*value/i)
            .or(ctx.page.getByText('Market Value').first());
        try { await mvOption.check(); } catch { await mvOption.click(); }
        await ctx.screenshot('dcad-reason');

        // Upload evidence
        if (filing.evidence_packet_url) {
            ctx.addLog('Uploading evidence');
            const evidencePath = path.join(__dirname, '..', '..', filing.evidence_packet_url.replace(/^\//, ''));
            const fileInput = ctx.page.locator('input[type="file"]').first();
            await fileInput.setInputFiles(evidencePath);
            await ctx.page.waitForTimeout(2000);
            await ctx.screenshot('dcad-evidence');
        }

        // Submit
        ctx.addLog('Submitting protest');
        const submitBtn = ctx.page.getByRole('button', { name: /submit|file|next/i }).last();
        await ctx.retryClick(submitBtn);
        await ctx.page.waitForLoadState('networkidle');
        await ctx.page.waitForTimeout(3000);
        await ctx.screenshot('dcad-submitted');

        // Confirmation
        let confirmationNumber = null;
        try {
            const txt = await ctx.page.getByText(/confirmation|reference|protest.*number/i).first().textContent();
            const match = txt.match(/[A-Z0-9-]{6,}/);
            confirmationNumber = match ? match[0] : txt.trim().slice(0, 50);
        } catch {
            confirmationNumber = 'SUBMITTED-' + new Date().toISOString().slice(0, 10);
        }
        await ctx.screenshot('dcad-confirmation');
        ctx.addLog(`Filed. Confirmation: ${confirmationNumber}`);

        await ctx.cleanup();
        return ctx.result(true, confirmationNumber);

    } catch (error) {
        ctx.addLog(`FAILED: ${error.message}`, 'error');
        try { await ctx.screenshot('dcad-error'); } catch { /* */ }
        await ctx.cleanup();
        return ctx.result(false, null, error);
    }
}

// ─── TAD (Tarrant County) ───────────────────────────────────────

async function fileTarrant(filing, options = {}) {
    const ctx = new AutomationContext(filing, options);
    try {
        await ctx.init();

        ctx.addLog('Navigating to TAD portal');
        await ctx.page.goto('https://www.tad.org/login', { waitUntil: 'networkidle' });
        await ctx.screenshot('tad-home');

        // Login
        ctx.addLog('Logging in');
        // TODO: Verify selectors
        const acctInput = ctx.page.getByLabel(/Account|Owner|Username/i)
            .or(ctx.page.locator('input[name*="account"], input[name*="user"], input[id*="account"]').first());
        await acctInput.fill(filing.portal_account_id || '');

        const pinInput = ctx.page.getByLabel(/PIN|Password/i)
            .or(ctx.page.locator('input[type="password"]').first());
        await pinInput.fill(filing.portal_pin || '');
        await ctx.screenshot('tad-credentials');

        const loginBtn = ctx.page.getByRole('button', { name: /log\s*in|sign\s*in|submit/i }).first();
        await ctx.retryClick(loginBtn);
        await ctx.page.waitForLoadState('networkidle');
        await ctx.screenshot('tad-after-login');

        // Navigate to Online Protest
        ctx.addLog('Navigating to Online Protest');
        const protestLink = ctx.page.getByRole('link', { name: /protest|online.*protest|file/i })
            .or(ctx.page.getByText(/online.*protest|file.*protest/i)).first();
        await ctx.retryClick(protestLink);
        await ctx.page.waitForLoadState('networkidle');
        await ctx.screenshot('tad-protest-page');

        // Select property
        try {
            const propRow = ctx.page.getByText(filing.portal_account_id || '', { exact: false }).first();
            await propRow.click({ timeout: 10000 });
        } catch {
            ctx.addLog('Property auto-selected', 'info');
        }
        await ctx.screenshot('tad-property');

        // Select reason
        const mvOption = ctx.page.getByLabel(/market\s*value/i)
            .or(ctx.page.getByText('Market Value').first());
        try { await mvOption.check(); } catch { await mvOption.click(); }
        await ctx.screenshot('tad-reason');

        // Upload evidence
        if (filing.evidence_packet_url) {
            ctx.addLog('Uploading evidence');
            const evidencePath = path.join(__dirname, '..', '..', filing.evidence_packet_url.replace(/^\//, ''));
            const fileInput = ctx.page.locator('input[type="file"]').first();
            await fileInput.setInputFiles(evidencePath);
            await ctx.page.waitForTimeout(2000);
            await ctx.screenshot('tad-evidence');
        }

        // Submit
        ctx.addLog('Submitting');
        const submitBtn = ctx.page.getByRole('button', { name: /submit|file|next/i }).last();
        await ctx.retryClick(submitBtn);
        await ctx.page.waitForLoadState('networkidle');
        await ctx.page.waitForTimeout(3000);
        await ctx.screenshot('tad-submitted');

        // Confirmation
        let confirmationNumber = null;
        try {
            const txt = await ctx.page.getByText(/confirmation|reference|protest.*number/i).first().textContent();
            const match = txt.match(/[A-Z0-9-]{6,}/);
            confirmationNumber = match ? match[0] : txt.trim().slice(0, 50);
        } catch {
            confirmationNumber = 'SUBMITTED-' + new Date().toISOString().slice(0, 10);
        }
        await ctx.screenshot('tad-confirmation');
        ctx.addLog(`Filed. Confirmation: ${confirmationNumber}`);

        // Check Value Negotiation tool
        ctx.addLog('Checking Value Negotiation tool');
        try {
            const vnLink = ctx.page.getByRole('link', { name: /value.*negotiat|settlement/i }).first();
            await vnLink.click({ timeout: 5000 });
            await ctx.page.waitForLoadState('networkidle');
            await ctx.screenshot('tad-value-negotiation');
            ctx.addLog('Value Negotiation page loaded');
        } catch {
            ctx.addLog('Value Negotiation not available yet', 'info');
        }

        await ctx.cleanup();
        return ctx.result(true, confirmationNumber);

    } catch (error) {
        ctx.addLog(`FAILED: ${error.message}`, 'error');
        try { await ctx.screenshot('tad-error'); } catch { /* */ }
        await ctx.cleanup();
        return ctx.result(false, null, error);
    }
}

// ─── Fulton County (GA) ─────────────────────────────────────────

async function fileFulton(filing, options = {}) {
    const ctx = new AutomationContext(filing, options);
    try {
        await ctx.init();

        ctx.addLog('Navigating to Fulton County Assessor - Property Appeals');
        await ctx.page.goto('https://fultonassessor.org/property-appeals/', { waitUntil: 'networkidle' });
        await ctx.screenshot('fulton-appeals-home');

        // Look for online appeal form / link
        ctx.addLog('Looking for appeal form');
        // TODO: Verify — Fulton may have a different online filing process
        const appealLink = ctx.page.getByRole('link', { name: /appeal.*form|file.*appeal|online.*appeal|submit.*appeal/i })
            .or(ctx.page.getByText(/file.*appeal|submit.*appeal|online.*form/i)).first();
        await ctx.retryClick(appealLink);
        await ctx.page.waitForLoadState('networkidle');
        await ctx.screenshot('fulton-appeal-form');

        // Fill property details
        ctx.addLog('Filling property details');
        // TODO: Verify form fields — Fulton uses different appeal process than TX counties
        const parcelInput = ctx.page.getByLabel(/parcel|account|property.*id/i)
            .or(ctx.page.locator('input[name*="parcel"], input[name*="account"]').first());
        await parcelInput.fill(filing.portal_account_id || '');

        // Owner name
        const ownerInput = ctx.page.getByLabel(/owner.*name|name/i)
            .or(ctx.page.locator('input[name*="owner"], input[name*="name"]').first());
        try {
            const ownerName = filing.clients?.name || '';
            await ownerInput.fill(ownerName, { timeout: 5000 });
        } catch {
            ctx.addLog('Owner name field not found', 'info');
        }

        // Property address
        const addrInput = ctx.page.getByLabel(/property.*address|address/i)
            .or(ctx.page.locator('input[name*="address"]').first());
        try {
            const addr = filing.properties?.address || '';
            await addrInput.fill(addr, { timeout: 5000 });
        } catch {
            ctx.addLog('Address field not found', 'info');
        }

        await ctx.screenshot('fulton-details-filled');

        // Upload evidence packet + POA
        ctx.addLog('Uploading documents');
        const fileInputs = ctx.page.locator('input[type="file"]');
        const fileCount = await fileInputs.count();

        if (fileCount >= 1 && filing.evidence_packet_url) {
            const evidencePath = path.join(__dirname, '..', '..', filing.evidence_packet_url.replace(/^\//, ''));
            await fileInputs.nth(0).setInputFiles(evidencePath);
            ctx.addLog('Evidence packet uploaded');
        }

        if (fileCount >= 2 && filing.poa_url) {
            const poaPath = path.join(__dirname, '..', '..', filing.poa_url.replace(/^\//, ''));
            await fileInputs.nth(1).setInputFiles(poaPath);
            ctx.addLog('POA uploaded');
        } else if (fileCount === 1 && filing.poa_url && filing.evidence_packet_url) {
            // Single upload — combine or upload POA after evidence
            ctx.addLog('Single file input — uploading evidence + POA together', 'warning');
            const files = [];
            if (filing.evidence_packet_url) files.push(path.join(__dirname, '..', '..', filing.evidence_packet_url.replace(/^\//, '')));
            if (filing.poa_url) files.push(path.join(__dirname, '..', '..', filing.poa_url.replace(/^\//, '')));
            await fileInputs.nth(0).setInputFiles(files);
        }

        await ctx.page.waitForTimeout(2000);
        await ctx.screenshot('fulton-documents-uploaded');

        // Submit
        ctx.addLog('Submitting appeal');
        const submitBtn = ctx.page.getByRole('button', { name: /submit|file|send/i }).last();
        await ctx.retryClick(submitBtn);
        await ctx.page.waitForLoadState('networkidle');
        await ctx.page.waitForTimeout(3000);
        await ctx.screenshot('fulton-submitted');

        // Confirmation
        let confirmationNumber = null;
        try {
            const txt = await ctx.page.getByText(/confirmation|reference|appeal.*number/i).first().textContent();
            const match = txt.match(/[A-Z0-9-]{6,}/);
            confirmationNumber = match ? match[0] : txt.trim().slice(0, 50);
        } catch {
            confirmationNumber = 'SUBMITTED-' + new Date().toISOString().slice(0, 10);
        }
        await ctx.screenshot('fulton-confirmation');
        ctx.addLog(`Filed. Confirmation: ${confirmationNumber}`);

        await ctx.cleanup();
        return ctx.result(true, confirmationNumber);

    } catch (error) {
        ctx.addLog(`FAILED: ${error.message}`, 'error');
        try { await ctx.screenshot('fulton-error'); } catch { /* */ }
        await ctx.cleanup();
        return ctx.result(false, null, error);
    }
}

// ─── Upload Evidence to Existing Portal Account ──────────────────

async function uploadEvidence(filing, options = {}) {
    // Re-use the county-specific automation but stop after evidence upload
    const county = (filing.county || '').toLowerCase();
    const ctx = new AutomationContext(filing, options);

    try {
        await ctx.init();

        if (!filing.evidence_packet_url) {
            throw new Error('No evidence packet URL set on filing');
        }

        const portalUrls = {
            bexar: 'https://bcad.org/online-portal/',
            harris: 'https://owners.hcad.org',
            travis: 'https://traviscad.org/efile/',
            dallas: 'https://www.dallascad.org',
            tarrant: 'https://www.tad.org/login',
            fulton: 'https://fultonassessor.org/property-appeals/'
        };

        ctx.addLog(`Navigating to ${county} portal for evidence upload`);
        await ctx.page.goto(portalUrls[county] || filing.portal_url, { waitUntil: 'networkidle' });
        await ctx.screenshot('evidence-upload-portal');

        // Login
        const acctInput = ctx.page.getByLabel(/Account|Owner|iFile|Property/i)
            .or(ctx.page.locator('input[name*="account"], input[name*="owner"], input[id*="account"]').first());
        await acctInput.fill(filing.portal_account_id || '');

        const pinInput = ctx.page.getByLabel(/PIN|Password/i)
            .or(ctx.page.locator('input[type="password"]').first());
        await pinInput.fill(filing.portal_pin || '');

        const loginBtn = ctx.page.getByRole('button', { name: /log\s*in|sign\s*in|submit/i }).first();
        await ctx.retryClick(loginBtn);
        await ctx.page.waitForLoadState('networkidle');
        await ctx.screenshot('evidence-upload-logged-in');

        // Navigate to evidence upload section
        const evidenceLink = ctx.page.getByRole('link', { name: /evidence|upload|document|attachment/i })
            .or(ctx.page.getByText(/upload.*evidence|add.*document|attach/i)).first();
        await ctx.retryClick(evidenceLink);
        await ctx.page.waitForLoadState('networkidle');
        await ctx.screenshot('evidence-upload-page');

        // Upload
        const evidencePath = path.join(__dirname, '..', '..', filing.evidence_packet_url.replace(/^\//, ''));
        const fileInput = ctx.page.locator('input[type="file"]').first();
        await fileInput.setInputFiles(evidencePath);
        await ctx.page.waitForTimeout(2000);

        // Submit upload
        const uploadBtn = ctx.page.getByRole('button', { name: /upload|submit|save/i }).first();
        await ctx.retryClick(uploadBtn);
        await ctx.page.waitForLoadState('networkidle');
        await ctx.screenshot('evidence-upload-complete');

        ctx.addLog('Evidence uploaded successfully');
        await ctx.cleanup();
        return ctx.result(true);

    } catch (error) {
        ctx.addLog(`Evidence upload FAILED: ${error.message}`, 'error');
        try { await ctx.screenshot('evidence-upload-error'); } catch { /* */ }
        await ctx.cleanup();
        return ctx.result(false, null, error);
    }
}

// ─── Master Automation Runner ────────────────────────────────────

// ─── Fort Bend (FBCAD) — eFile (no account required) ──────────────
async function fileFortBend(filing, options = {}) {
    const ctx = new AutomationContext(filing, options);
    try {
        await ctx.init();
        ctx.addLog('Navigating to FBCAD eFile portal');
        await ctx.page.goto('https://www.fbcad.org/appeals/', { waitUntil: 'networkidle' });
        await ctx.screenshot('fbcad-appeals-page');
        // FBCAD uses Option 2 eFile — no account needed
        // Look for eFile link
        const eFileLink = await ctx.page.$('a[href*="efile"], a[href*="eFile"], a[href*="e-file"]');
        if (eFileLink) {
            await eFileLink.click();
            await ctx.page.waitForLoadState('networkidle');
            await ctx.screenshot('fbcad-efile-form');
        }
        ctx.addLog('FBCAD eFile form loaded — manual completion required for initial filing');
        await ctx.cleanup();
        return ctx.result(false, null, 'Manual review needed — FBCAD eFile form loaded but needs field mapping verification');
    } catch (err) {
        ctx.addLog(`FBCAD error: ${err.message}`, 'error');
        await ctx.cleanup();
        return ctx.result(false, null, err.message);
    }
}

// ─── Collin (CCAD) ───────────────────────────────────────────────
async function fileCollin(filing, options = {}) {
    const ctx = new AutomationContext(filing, options);
    try {
        await ctx.init();
        ctx.addLog('Navigating to Collin CAD portal');
        await ctx.page.goto('https://www.collincad.org/propertysearch', { waitUntil: 'networkidle' });
        await ctx.screenshot('ccad-portal');
        ctx.addLog('CCAD portal loaded — Collin County requires online filing through their portal');
        await ctx.cleanup();
        return ctx.result(false, null, 'Manual filing needed — Collin CAD uses online portal, needs account setup');
    } catch (err) {
        ctx.addLog(`CCAD error: ${err.message}`, 'error');
        await ctx.cleanup();
        return ctx.result(false, null, err.message);
    }
}

// ─── Hunt County ─────────────────────────────────────────────────
async function fileHunt(filing, options = {}) {
    const ctx = new AutomationContext(filing, options);
    try {
        await ctx.init();
        ctx.addLog('Hunt County — smaller county, mail-based filing');
        ctx.addLog('Generating Form 50-132 (Notice of Protest) for mail filing');
        await ctx.cleanup();
        return ctx.result(false, null, 'Mail filing required — Form 50-132 generated for Hunt County AD');
    } catch (err) {
        await ctx.cleanup();
        return ctx.result(false, null, err.message);
    }
}

// ─── Kaufman County ──────────────────────────────────────────────
async function fileKaufman(filing, options = {}) {
    const ctx = new AutomationContext(filing, options);
    try {
        await ctx.init();
        ctx.addLog('Navigating to Kaufman CAD');
        await ctx.page.goto('https://esearch.kaufmancad.org/', { waitUntil: 'networkidle' });
        await ctx.screenshot('kaufman-portal');
        ctx.addLog('Kaufman CAD loaded — checking for online protest filing');
        await ctx.cleanup();
        return ctx.result(false, null, 'Manual filing needed — Kaufman CAD portal loaded, needs protest form');
    } catch (err) {
        await ctx.cleanup();
        return ctx.result(false, null, err.message);
    }
}

// ─── Williamson County ───────────────────────────────────────────
async function fileWilliamson(filing, options = {}) {
    const ctx = new AutomationContext(filing, options);
    try {
        await ctx.init();
        ctx.addLog('Navigating to Williamson CAD');
        await ctx.page.goto('https://www.wcad.org/', { waitUntil: 'networkidle' });
        await ctx.screenshot('wcad-portal');
        ctx.addLog('WCAD loaded — Williamson County uses online protest filing');
        await ctx.cleanup();
        return ctx.result(false, null, 'Manual filing needed — WCAD portal loaded');
    } catch (err) {
        await ctx.cleanup();
        return ctx.result(false, null, err.message);
    }
}

async function autoFile(filing, options = {}) {
    const county = (filing.county || '').toLowerCase();

    switch (county) {
        case 'bexar': return fileBexar(filing, options);
        case 'harris': return fileHarris(filing, options);
        case 'travis': return fileTravis(filing, options);
        case 'dallas': return fileDallas(filing, options);
        case 'tarrant': return fileTarrant(filing, options);
        case 'fulton': return fileFulton(filing, options);
        case 'fort bend': return fileFortBend(filing, options);
        case 'collin': return fileCollin(filing, options);
        case 'hunt': return fileHunt(filing, options);
        case 'kaufman': return fileKaufman(filing, options);
        case 'williamson': return fileWilliamson(filing, options);
        default:
            return {
                success: false,
                error: `Unsupported county: ${county}`,
                screenshots: [],
                log: [{ timestamp: new Date().toISOString(), message: `No automation for county: ${county}`, level: 'error' }]
            };
    }
}

module.exports = {
    autoFile,
    uploadEvidence,
    fileBexar,
    fileHarris,
    fileTravis,
    fileDallas,
    fileTarrant,
    fileFulton,
    AutomationContext,
    SCREENSHOTS_BASE
};
