/**
 * Auto-Filing System — prepares filing packages AND automates eFile submissions.
 * 
 * Capabilities:
 * 1. Generate pre-filled Form 50-132 (Notice of Protest) PDFs
 * 2. Automate FBCAD eFile portal submission via Puppeteer
 * 3. Send confirmation notifications to clients and Tyler
 * 
 * FBCAD eFile (Option 2): No account required — electronic filing of Notice of Protest.
 * URL: https://www.fbcad.org/appeals/ → Option 2 → "File Now"
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const FILING_DIR = path.join(__dirname, '..', 'filing-packages');
const CONFIRMATIONS_DIR = path.join(__dirname, '..', 'filing-confirmations');
const SIGNED_FORMS_DIR = path.join(__dirname, '..', 'generated-forms');

// ─── Filing Package Generation (Original) ──────────────────

/**
 * Prepare a complete filing data package for a case.
 */
async function prepareFilingPackage(caseData, propertyData, compResults) {
    await fs.promises.mkdir(FILING_DIR, { recursive: true });

    const filingData = {
        preparedAt: new Date().toISOString(),
        caseId: caseData.caseId,
        status: 'ready-to-file',

        // Form 50-132 fields
        form50132: {
            propertyOwner: caseData.ownerName,
            mailingAddress: caseData.propertyAddress,
            propertyDescription: propertyData.address || caseData.propertyAddress,
            accountNumber: propertyData.accountId || caseData.pin || '',
            appraisalDistrict: detectDistrict(caseData.propertyAddress),
            taxYear: new Date().getFullYear(),
            protestReasons: [
                'Value is over market value',
                'Value is unequal compared with other properties'
            ],
            agentName: 'OverAssessed, LLC',
            agentAddress: 'San Antonio, TX',
            agentPhone: '(210) 760-7236',
            currentValue: propertyData.assessedValue,
            requestedValue: compResults.recommendedValue,
            supportingEvidence: 'Comparable sales analysis attached'
        },

        currentAssessedValue: propertyData.assessedValue,
        recommendedValue: compResults.recommendedValue,
        estimatedReduction: compResults.reduction,
        estimatedTaxSavings: compResults.estimatedSavings,
        comparablesCount: compResults.comps.length,

        checklist: {
            propertyDataPulled: !!propertyData,
            compsIdentified: compResults.comps.length >= 3,
            evidencePacketGenerated: !!caseData.evidencePacketPath,
            formSigned: !!caseData.signature,
            readyToFile: !!caseData.signature && compResults.comps.length >= 3
        }
    };

    const pdfPath = await generateFilingPDF(caseData, propertyData, compResults, filingData);
    filingData.filingPdfPath = pdfPath;

    return filingData;
}

/**
 * Generate a pre-filled Form 50-132 (Notice of Protest) PDF.
 */
async function generateFilingPDF(caseData, propertyData, compResults, filingData) {
    const filename = `${(caseData.caseId || 'case').replace(/[^a-zA-Z0-9-]/g, '')}-Filing-Package.pdf`;
    const filepath = path.join(FILING_DIR, filename);
    await fs.promises.mkdir(FILING_DIR, { recursive: true });

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'letter',
            margins: { top: 50, bottom: 50, left: 60, right: 60 }
        });

        const stream = fs.createWriteStream(filepath);
        doc.pipe(stream);

        const form = filingData.form50132;

        // PAGE 1: NOTICE OF PROTEST
        doc.fontSize(10).fillColor('#333').font('Helvetica-Bold')
            .text('NOTICE OF PROTEST', { align: 'center' });
        doc.fontSize(8).fillColor('#666').font('Helvetica')
            .text('Form 50-132 — Property Tax Protest', { align: 'center' });
        doc.moveDown(0.5);

        drawFormField(doc, 'Appraisal District:', form.appraisalDistrict);
        drawFormField(doc, 'Tax Year:', String(form.taxYear));
        doc.moveDown(0.5);

        drawSectionHeader(doc, 'SECTION 1: PROPERTY OWNER INFORMATION');
        drawFormField(doc, 'Property Owner Name:', form.propertyOwner);
        drawFormField(doc, 'Mailing Address:', form.mailingAddress);
        doc.moveDown(0.3);

        drawSectionHeader(doc, 'SECTION 2: PROPERTY DESCRIPTION');
        drawFormField(doc, 'Property Address:', form.propertyDescription);
        drawFormField(doc, 'Account/Property ID:', form.accountNumber || '(to be provided)');
        doc.moveDown(0.3);

        drawSectionHeader(doc, 'SECTION 3: REASON FOR PROTEST');
        form.protestReasons.forEach(reason => {
            doc.fontSize(10).font('Helvetica').text(`  ☑  ${reason}`, { indent: 20 });
        });
        doc.moveDown(0.3);

        drawSectionHeader(doc, 'SECTION 4: OPINION OF VALUE');
        drawFormField(doc, 'Current Appraised Value:', `$${(form.currentValue || 0).toLocaleString()}`);
        drawFormField(doc, 'Requested/Opinion of Value:', `$${(form.requestedValue || 0).toLocaleString()}`);
        drawFormField(doc, 'Potential Reduction:', `$${(filingData.estimatedReduction || 0).toLocaleString()}`);
        doc.moveDown(0.3);

        drawSectionHeader(doc, 'SECTION 5: AGENT INFORMATION');
        drawFormField(doc, 'Agent Name:', form.agentName);
        drawFormField(doc, 'Agent Address:', form.agentAddress);
        drawFormField(doc, 'Agent Phone:', form.agentPhone);
        drawFormField(doc, 'Supporting Evidence:', form.supportingEvidence);
        doc.moveDown(2);

        doc.moveTo(60, doc.y).lineTo(300, doc.y).stroke();
        doc.fontSize(8).fillColor('#666').text('Signature of Property Owner or Agent', 60);
        doc.moveDown(1);
        doc.moveTo(60, doc.y).lineTo(300, doc.y).stroke();
        doc.text('Date');

        // PAGE 2: FILING CHECKLIST
        doc.addPage();
        doc.fontSize(14).fillColor('#333').font('Helvetica-Bold')
            .text('Filing Checklist', { align: 'center' });
        doc.moveDown(1);

        const checklist = [
            ['Property data retrieved', filingData.checklist.propertyDataPulled],
            ['Comparable properties identified (3+)', filingData.checklist.compsIdentified],
            ['Evidence packet generated', filingData.checklist.evidencePacketGenerated],
            ['Form 50-162 signed by owner', filingData.checklist.formSigned],
            ['Ready to file', filingData.checklist.readyToFile]
        ];

        checklist.forEach(([item, done]) => {
            const icon = done ? '✅' : '⬜';
            doc.fontSize(11).fillColor('#333').font('Helvetica').text(`${icon}  ${item}`);
            doc.moveDown(0.3);
        });

        doc.moveDown(2);
        doc.fontSize(10).fillColor('#666').font('Helvetica')
            .text(`Case: ${caseData.caseId}`, { align: 'center' });
        doc.text(`Prepared: ${new Date().toLocaleDateString()}`, { align: 'center' });
        doc.text('OverAssessed — San Antonio, Texas', { align: 'center' });

        doc.end();
        stream.on('finish', () => resolve(filepath));
        stream.on('error', reject);
    });
}

// ─── FBCAD eFile Automation ────────────────────────────────

/**
 * File a protest via FBCAD eFile portal (Option 2 — no account required).
 * 
 * Steps:
 * 1. Navigate to FBCAD appeals page
 * 2. Click through to the eFile form
 * 3. Fill in property owner info, account number, protest reasons
 * 4. Upload signed Form 50-162 if available
 * 5. Submit and capture confirmation
 * 
 * @param {Object} client - Client data from value-monitor
 * @returns {Object} Filing result with confirmation details
 */
async function fileFBCADProtest(client) {
    const puppeteer = require('puppeteer');
    
    await fs.promises.mkdir(CONFIRMATIONS_DIR, { recursive: true });
    
    console.log(`[AutoFile] Starting FBCAD eFile for ${client.caseId} (${client.ownerName})`);
    
    const result = {
        caseId: client.caseId,
        county: 'Fort Bend',
        method: 'FBCAD eFile',
        startedAt: new Date().toISOString(),
        success: false,
        confirmationNumber: null,
        screenshotPath: null,
        confirmationPdfPath: null,
        error: null,
    };

    let browser = null;
    
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--window-size=1280,900',
            ],
            defaultViewport: { width: 1280, height: 900 },
        });

        const page = await browser.newPage();
        
        // Set a reasonable timeout
        page.setDefaultNavigationTimeout(60000);
        page.setDefaultTimeout(30000);
        
        // ── Step 1: Navigate to FBCAD Appeals page ──
        console.log('[AutoFile] Step 1: Navigating to FBCAD appeals page...');
        await page.goto('https://www.fbcad.org/appeals/', { waitUntil: 'networkidle2' });
        
        // Take a screenshot for debugging
        const step1Screenshot = path.join(CONFIRMATIONS_DIR, `${client.caseId}-step1-appeals-page.png`);
        await page.screenshot({ path: step1Screenshot, fullPage: false });
        
        // ── Step 2: Find and click the eFile "File Now" link (Option 2) ──
        console.log('[AutoFile] Step 2: Looking for eFile option...');
        
        // The eFile link might be directly on the page or in a specific section
        // Try multiple selectors to find the eFile link
        const efileSelectors = [
            'a[href*="efile"]',
            'a[href*="eFile"]',
            'a[href*="e-file"]',
            'a[href*="protest"]',
            'a:contains("File Now")',
        ];
        
        let efileClicked = false;
        
        // First, try to find links with "File Now" text near "eFile" or "Option 2"
        const links = await page.$$eval('a', anchors => 
            anchors.map(a => ({
                href: a.href,
                text: a.textContent.trim(),
                className: a.className,
            }))
        );
        
        console.log('[AutoFile] Found links:', links.filter(l => 
            l.text.toLowerCase().includes('file') || 
            l.href.toLowerCase().includes('file') ||
            l.href.toLowerCase().includes('protest')
        ).map(l => `${l.text} -> ${l.href}`));
        
        // Look for the eFile-specific link
        for (const link of links) {
            if (
                (link.href.includes('efile') || link.href.includes('eFile') || link.href.includes('e-file')) ||
                (link.text.toLowerCase().includes('file now') && !link.href.includes('online'))
            ) {
                console.log(`[AutoFile] Clicking eFile link: ${link.text} -> ${link.href}`);
                await page.goto(link.href, { waitUntil: 'networkidle2' });
                efileClicked = true;
                break;
            }
        }
        
        if (!efileClicked) {
            // Try clicking by visible text
            try {
                const buttons = await page.$$('a, button');
                for (const btn of buttons) {
                    const text = await btn.evaluate(el => el.textContent.trim());
                    if (text.toLowerCase().includes('file now')) {
                        // Check if it's near "eFile" or "Option 2"
                        const parentText = await btn.evaluate(el => {
                            let parent = el.parentElement;
                            for (let i = 0; i < 5 && parent; i++) {
                                if (parent.textContent.includes('eFile') || parent.textContent.includes('Option 2')) {
                                    return 'efile-context';
                                }
                                parent = parent.parentElement;
                            }
                            return 'other-context';
                        });
                        
                        if (parentText === 'efile-context') {
                            await btn.click();
                            await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
                            efileClicked = true;
                            break;
                        }
                    }
                }
            } catch (e) {
                console.log(`[AutoFile] Button search failed: ${e.message}`);
            }
        }
        
        const step2Screenshot = path.join(CONFIRMATIONS_DIR, `${client.caseId}-step2-efile-page.png`);
        await page.screenshot({ path: step2Screenshot, fullPage: false });
        
        // ── Step 3: Handle any "Next" buttons (deadline/duplicate filing warnings) ──
        console.log('[AutoFile] Step 3: Handling pre-form pages...');
        
        for (let i = 0; i < 3; i++) {
            try {
                const nextBtn = await page.$('button:has-text("Next"), a:has-text("Next"), input[value="Next"], .btn-next, button.next');
                if (nextBtn) {
                    await nextBtn.click();
                    await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
                    await new Promise(r => setTimeout(r, 1500));
                } else {
                    // Try XPath for "Next" text
                    const [nextByText] = await page.$x('//button[contains(text(), "Next")] | //a[contains(text(), "Next")]');
                    if (nextByText) {
                        await nextByText.click();
                        await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
                        await new Promise(r => setTimeout(r, 1500));
                    } else {
                        break;
                    }
                }
            } catch (e) {
                break;
            }
        }
        
        const step3Screenshot = path.join(CONFIRMATIONS_DIR, `${client.caseId}-step3-form.png`);
        await page.screenshot({ path: step3Screenshot, fullPage: true });

        // ── Step 4: Fill in the protest form ──
        console.log('[AutoFile] Step 4: Filling in protest form...');
        
        // Collect all form inputs on the page
        const formFields = await page.$$eval('input, select, textarea', elements =>
            elements.map(el => ({
                tag: el.tagName.toLowerCase(),
                type: el.type,
                name: el.name,
                id: el.id,
                placeholder: el.placeholder,
                label: el.labels?.[0]?.textContent?.trim() || '',
                value: el.value,
                required: el.required,
            }))
        );
        
        console.log('[AutoFile] Form fields found:', JSON.stringify(formFields, null, 2));
        
        // Map client data to expected form fields
        // Common field name patterns for Texas protest forms:
        const fieldMappings = {
            // Property owner info
            ownerName: [
                'owner_name', 'ownerName', 'property_owner', 'propertyOwner',
                'name', 'full_name', 'fullName', 'OwnerName', 'owner-name'
            ],
            mailingAddress: [
                'mailing_address', 'mailingAddress', 'address', 'owner_address',
                'mail_address', 'street_address', 'Address', 'MailingAddress'
            ],
            city: ['city', 'owner_city', 'City'],
            state: ['state', 'owner_state', 'State'],
            zip: ['zip', 'zipcode', 'zip_code', 'owner_zip', 'Zip', 'ZipCode'],
            phone: ['phone', 'phone_number', 'phoneNumber', 'Phone', 'owner_phone'],
            email: ['email', 'owner_email', 'Email', 'emailAddress'],
            
            // Property info
            accountNumber: [
                'account_number', 'accountNumber', 'account', 'account_id',
                'property_id', 'propertyId', 'pin', 'Account', 'AccountNumber',
                'acct', 'acct_number'
            ],
            propertyAddress: [
                'property_address', 'propertyAddress', 'situs_address',
                'situsAddress', 'prop_address', 'PropertyAddress'
            ],
            
            // Agent info  
            agentName: [
                'agent_name', 'agentName', 'representative_name', 'AgentName'
            ],
            agentPhone: [
                'agent_phone', 'agentPhone', 'AgentPhone'
            ],
        };
        
        // Parse address components
        const addressParts = parseAddress(client.propertyAddress);
        
        // Client data to fill
        const clientData = {
            ownerName: client.ownerName,
            mailingAddress: addressParts.street,
            city: addressParts.city,
            state: addressParts.state || 'TX',
            zip: addressParts.zip,
            phone: client.phone || '',
            email: client.email || '',
            accountNumber: client.accountId || '',
            propertyAddress: client.propertyAddress,
            agentName: 'OverAssessed, LLC',
            agentPhone: '(210) 760-7236',
        };

        // Try to fill fields by name/id matching
        for (const [dataKey, possibleNames] of Object.entries(fieldMappings)) {
            const value = clientData[dataKey];
            if (!value) continue;
            
            for (const fieldName of possibleNames) {
                try {
                    // Try by name attribute
                    const byName = await page.$(`input[name="${fieldName}"], textarea[name="${fieldName}"]`);
                    if (byName) {
                        await byName.click({ clickCount: 3 });
                        await byName.type(value, { delay: 50 });
                        console.log(`[AutoFile] Filled ${fieldName} = ${value}`);
                        break;
                    }
                    // Try by id attribute
                    const byId = await page.$(`#${fieldName}`);
                    if (byId) {
                        await byId.click({ clickCount: 3 });
                        await byId.type(value, { delay: 50 });
                        console.log(`[AutoFile] Filled #${fieldName} = ${value}`);
                        break;
                    }
                } catch (e) {
                    // Field not found, try next name
                }
            }
        }

        // Try to select protest reasons (checkboxes)
        const reasonPatterns = [
            'market value', 'over market', 'value is too high', 'excessive',
            'unequal', 'inequitable', 'compared with other',
        ];
        
        const checkboxes = await page.$$('input[type="checkbox"]');
        for (const cb of checkboxes) {
            try {
                const label = await cb.evaluate(el => {
                    const lbl = el.labels?.[0]?.textContent || '';
                    const parent = el.parentElement?.textContent || '';
                    return (lbl + ' ' + parent).toLowerCase();
                });
                
                if (reasonPatterns.some(p => label.includes(p))) {
                    const isChecked = await cb.evaluate(el => el.checked);
                    if (!isChecked) {
                        await cb.click();
                        console.log(`[AutoFile] Checked protest reason: ${label.substring(0, 60)}`);
                    }
                }
            } catch (e) {
                // Skip
            }
        }

        // Add "I want an Informal Conference" in Section 4 if there's a text area
        const textareas = await page.$$('textarea');
        for (const ta of textareas) {
            try {
                const name = await ta.evaluate(el => el.name || el.id || '');
                const label = await ta.evaluate(el => {
                    const lbl = el.labels?.[0]?.textContent || '';
                    const prevSibling = el.previousElementSibling?.textContent || '';
                    return (lbl + ' ' + prevSibling).toLowerCase();
                });
                
                if (label.includes('comment') || label.includes('section 4') || label.includes('additional') || label.includes('reason')) {
                    await ta.type('I want an Informal Conference. Market value is too high and appraisal is unequal compared to similar properties.', { delay: 30 });
                    console.log(`[AutoFile] Filled comment/reason textarea`);
                }
            } catch (e) {
                // Skip
            }
        }
        
        // ── Step 5: Upload Form 50-162 if available ──
        console.log('[AutoFile] Step 5: Looking for file upload...');
        
        const fileInputs = await page.$$('input[type="file"]');
        if (fileInputs.length > 0) {
            // Look for the signed form PDF
            const signedFormPath = findSignedForm(client.caseId);
            if (signedFormPath) {
                await fileInputs[0].uploadFile(signedFormPath);
                console.log(`[AutoFile] Uploaded signed form: ${signedFormPath}`);
            } else {
                console.log('[AutoFile] No signed form PDF found — skipping upload');
            }
        }

        const step4Screenshot = path.join(CONFIRMATIONS_DIR, `${client.caseId}-step4-filled.png`);
        await page.screenshot({ path: step4Screenshot, fullPage: true });

        // ── Step 6: Submit the form ──
        console.log('[AutoFile] Step 6: Submitting form...');
        
        // SAFETY CHECK: Don't actually submit in test/dry-run mode
        const DRY_RUN = process.env.AUTO_FILE_DRY_RUN !== 'false';
        
        if (DRY_RUN) {
            console.log('[AutoFile] ⚠️ DRY RUN MODE — form was filled but NOT submitted.');
            console.log('[AutoFile] Set AUTO_FILE_DRY_RUN=false in .env to enable actual submission.');
            
            result.success = false;
            result.dryRun = true;
            result.error = 'Dry run — form filled but not submitted. Set AUTO_FILE_DRY_RUN=false to submit.';
            result.screenshotPath = step4Screenshot;
            result.formFieldsFound = formFields;
            
        } else {
            // Find and click submit button
            const submitSelectors = [
                'button[type="submit"]',
                'input[type="submit"]',
                'button:has-text("Submit")',
                'button:has-text("File")',
                'a:has-text("Submit")',
            ];
            
            let submitted = false;
            for (const selector of submitSelectors) {
                try {
                    const btn = await page.$(selector);
                    if (btn) {
                        await btn.click();
                        submitted = true;
                        break;
                    }
                } catch (e) {
                    // Try next selector
                }
            }
            
            if (!submitted) {
                // Try XPath
                const [submitBtn] = await page.$x('//button[contains(text(), "Submit")] | //input[@type="submit"]');
                if (submitBtn) {
                    await submitBtn.click();
                    submitted = true;
                }
            }
            
            if (submitted) {
                // Wait for confirmation page
                await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
                await new Promise(r => setTimeout(r, 3000));
                
                // Take confirmation screenshot
                const confirmScreenshot = path.join(CONFIRMATIONS_DIR, `${client.caseId}-confirmation.png`);
                await page.screenshot({ path: confirmScreenshot, fullPage: true });
                result.screenshotPath = confirmScreenshot;
                
                // Try to extract confirmation number
                const pageText = await page.evaluate(() => document.body.innerText);
                const confirmMatch = pageText.match(/confirmation[:\s#]*([A-Z0-9-]+)/i) ||
                                     pageText.match(/reference[:\s#]*([A-Z0-9-]+)/i) ||
                                     pageText.match(/protest[:\s#]*([A-Z0-9-]+)/i);
                
                if (confirmMatch) {
                    result.confirmationNumber = confirmMatch[1];
                }
                
                // Save confirmation page as PDF
                const confirmPdfPath = path.join(CONFIRMATIONS_DIR, `${client.caseId}-confirmation.pdf`);
                await page.pdf({ path: confirmPdfPath, format: 'letter' });
                result.confirmationPdfPath = confirmPdfPath;
                
                result.success = true;
                console.log(`[AutoFile] ✅ Protest submitted successfully! Confirmation: ${result.confirmationNumber || 'see screenshot'}`);
            } else {
                result.error = 'Could not find submit button on the form';
                console.log('[AutoFile] ❌ Could not find submit button');
            }
        }
        
        result.completedAt = new Date().toISOString();
        
    } catch (err) {
        result.error = err.message;
        result.completedAt = new Date().toISOString();
        console.error(`[AutoFile] Error during FBCAD eFile: ${err.message}`);
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }

    // ── Step 7: Send notifications ──
    if (result.success || result.dryRun) {
        await sendFilingNotifications(client, result);
    }
    
    // ── Step 8: Update Supabase ──
    await updateFilingStatus(client, result);
    
    // Save result to state file
    saveFilingResult(client.caseId, result);
    
    return result;
}

// ─── Address Parser ────────────────────────────────────────

function parseAddress(fullAddress) {
    if (!fullAddress) return { street: '', city: '', state: '', zip: '' };
    
    // Pattern: "123 Street, City, ST 12345"
    const match = fullAddress.match(/^(.+?),\s*(.+?),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)$/);
    if (match) {
        return { street: match[1].trim(), city: match[2].trim(), state: match[3], zip: match[4] };
    }
    
    // Fallback: split by comma
    const parts = fullAddress.split(',').map(p => p.trim());
    if (parts.length >= 3) {
        const lastPart = parts[parts.length - 1];
        const stateZipMatch = lastPart.match(/([A-Z]{2})\s*(\d{5}(?:-\d{4})?)/);
        return {
            street: parts[0],
            city: parts[1],
            state: stateZipMatch ? stateZipMatch[1] : '',
            zip: stateZipMatch ? stateZipMatch[2] : '',
        };
    }
    
    return { street: fullAddress, city: '', state: '', zip: '' };
}

// ─── Find Signed Form ──────────────────────────────────────

function findSignedForm(caseId) {
    const searchDirs = [
        SIGNED_FORMS_DIR,
        path.join(__dirname, '..', 'uploads'),
        path.join(__dirname, '..', 'signed-forms'),
    ];
    
    for (const dir of searchDirs) {
        if (!fs.existsSync(dir)) continue;
        
        const files = fs.readdirSync(dir);
        // Look for case-specific signed form
        const match = files.find(f => 
            f.toLowerCase().includes(caseId.toLowerCase()) && 
            f.toLowerCase().includes('50-162') &&
            f.endsWith('.pdf')
        );
        if (match) return path.join(dir, match);
        
        // Look for generic signed form
        const generic = files.find(f => 
            f.toLowerCase().includes('50-162') && 
            f.endsWith('.pdf')
        );
        if (generic) return path.join(dir, generic);
    }
    
    return null;
}

// ─── Notifications ─────────────────────────────────────────

async function sendFilingNotifications(client, result) {
    try {
        const { sendFilingNotification } = require('./notifications');
        
        const status = result.success ? 'filed' : (result.dryRun ? 'form_ready' : 'filing_created');
        const vars = {
            name: client.ownerName,
            propertyAddress: client.propertyAddress,
            county: client.county || 'Fort Bend',
            confirmationNumber: result.confirmationNumber || 'Pending',
        };

        // Notify client
        if (client.email) {
            await sendFilingNotification(client.email, status, vars);
        }
        
        // Always notify Tyler
        await sendFilingNotification('tyler@overassessed.ai', status, {
            ...vars,
            name: `[ADMIN] ${client.ownerName} (${client.caseId})`,
        });

        // SMS to Tyler
        const smsMessage = result.success
            ? `✅ PROTEST FILED: ${client.ownerName} (${client.caseId}) - Fort Bend eFile. Confirmation: ${result.confirmationNumber || 'see email'}`
            : result.dryRun
            ? `📋 DRY RUN: ${client.ownerName} (${client.caseId}) - FBCAD eFile form filled successfully. Review screenshots before enabling auto-submit.`
            : `⚠️ FILING ISSUE: ${client.caseId} - ${result.error}`;

        try {
            const twilio = require('twilio');
            const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
            await twilioClient.messages.create({
                body: smsMessage,
                from: process.env.TWILIO_SMS_NUMBER || process.env.TWILIO_PHONE_NUMBER,
                to: '+12105598725',
            });
        } catch (smsErr) {
            console.error('[AutoFile] SMS notification error:', smsErr.message);
        }

    } catch (err) {
        console.error('[AutoFile] Notification error:', err.message);
    }
}

// ─── Supabase Update ───────────────────────────────────────

async function updateFilingStatus(client, result) {
    try {
        const { supabaseAdmin, isSupabaseEnabled } = require('../lib/supabase');
        if (!isSupabaseEnabled()) return;
        
        const updateData = {
            filing_data: {
                ...(client.filingData || {}),
                efileResult: {
                    method: result.method,
                    success: result.success,
                    dryRun: result.dryRun || false,
                    confirmationNumber: result.confirmationNumber,
                    screenshotPath: result.screenshotPath,
                    confirmationPdfPath: result.confirmationPdfPath,
                    error: result.error,
                    startedAt: result.startedAt,
                    completedAt: result.completedAt,
                },
            },
            updated_at: new Date().toISOString(),
        };
        
        if (result.success) {
            updateData.status = 'Filed';
        }

        await supabaseAdmin
            .from('submissions')
            .update(updateData)
            .eq('case_id', client.caseId);
            
        console.log(`[AutoFile] Updated Supabase filing status for ${client.caseId}`);
    } catch (err) {
        console.error(`[AutoFile] Supabase update error: ${err.message}`);
    }
}

// ─── Filing Result Persistence ─────────────────────────────

function saveFilingResult(caseId, result) {
    const STATE_FILE = path.join(__dirname, '..', 'filing-monitor-state.json');
    try {
        let state = {};
        if (fs.existsSync(STATE_FILE)) {
            state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        }
        
        if (!state.filingResults) state.filingResults = {};
        state.filingResults[caseId] = result;
        state.lastFilingAttempt = new Date().toISOString();
        
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
        console.error(`[AutoFile] Error saving filing result: ${err.message}`);
    }
}

// ─── PDF Helpers ───────────────────────────────────────────

function drawSectionHeader(doc, text) {
    const y = doc.y;
    doc.rect(60, y, 492, 18).fill('#6c5ce7');
    doc.fontSize(9).fillColor('white').font('Helvetica-Bold')
        .text(text, 70, y + 4, { width: 472 });
    doc.y = y + 24;
}

function drawFormField(doc, label, value) {
    const y = doc.y;
    doc.fontSize(9).fillColor('#666').font('Helvetica')
        .text(label, 70, y, { width: 160, continued: false });
    doc.fontSize(10).fillColor('#333').font('Helvetica-Bold')
        .text(value || '—', 230, y, { width: 310 });
    doc.y = Math.max(doc.y, y + 18);
}

function detectDistrict(address) {
    const addr = (address || '').toLowerCase();
    if (addr.includes('richmond') || addr.includes('sugar land') || addr.includes('rosenberg') || addr.includes('fort bend')) return 'Fort Bend Central Appraisal District (FBCAD)';
    if (addr.includes('houston') || addr.includes('harris')) return 'Harris County Appraisal District (HCAD)';
    if (addr.includes('austin') || addr.includes('travis')) return 'Travis County Appraisal District (TCAD)';
    if (addr.includes('plano') || addr.includes('mckinney') || addr.includes('frisco') || addr.includes('collin')) return 'Collin Central Appraisal District (CCAD)';
    if (addr.includes('greenville') || addr.includes('hunt')) return 'Hunt County Appraisal District';
    return 'Bexar County Appraisal District (BCAD)';
}

// ─── Annual Monitoring ─────────────────────────────────────

async function checkAnnualMonitoring() {
    console.log('[AnnualMonitoring] Starting annual monitoring check...');
    try {
        const { supabaseAdmin, isSupabaseEnabled } = require('../lib/supabase');
        if (!isSupabaseEnabled()) {
            console.log('[AnnualMonitoring] Supabase not enabled, skipping.');
            return;
        }

        const { data: clients, error } = await supabaseAdmin
            .from('clients')
            .select('id, name, email, phone')
            .eq('annual_monitoring', true);

        if (error) throw error;
        console.log(`[AnnualMonitoring] Found ${clients.length} clients enrolled in monitoring.`);

        for (const client of clients) {
            const { data: properties } = await supabaseAdmin
                .from('properties')
                .select('id, address, state')
                .eq('client_id', client.id);

            for (const prop of (properties || [])) {
                console.log(`[AnnualMonitoring] Would check assessment for ${prop.address} (client: ${client.name})`);
            }
        }

        console.log('[AnnualMonitoring] Check complete.');
    } catch (err) {
        console.error('[AnnualMonitoring] Error:', err.message);
    }
}

// ─── CLI Entry Point ───────────────────────────────────────

if (require.main === module) {
    const args = process.argv.slice(2);
    const command = args[0] || 'help';
    
    if (command === 'fbcad' || command === 'efile') {
        const caseId = args[1] || 'OA-0010';
        console.log(`[AutoFile] Manual FBCAD eFile for case ${caseId}`);
        
        // Load client data from Supabase or use defaults
        const { supabaseAdmin, isSupabaseEnabled } = require('../lib/supabase');
        
        (async () => {
            let client;
            if (isSupabaseEnabled()) {
                const { data } = await supabaseAdmin
                    .from('submissions')
                    .select('*')
                    .eq('case_id', caseId)
                    .single();
                
                if (data) {
                    client = {
                        caseId: data.case_id,
                        ownerName: data.owner_name,
                        propertyAddress: data.property_address,
                        county: data.county,
                        accountId: data.pin || 'R523440',
                        email: data.email,
                        phone: data.phone,
                        hasSigned: !!(data.signature && data.signature.authorized),
                        filingData: data.filing_data,
                    };
                }
            }
            
            if (!client) {
                client = {
                    caseId: 'OA-0010',
                    ownerName: 'Khiem Nguyen',
                    propertyAddress: '3315 Marlene Meadow Way, Richmond, TX 77406',
                    county: 'Fort Bend',
                    accountId: 'R523440',
                    email: null,
                    phone: null,
                    hasSigned: true,
                };
            }
            
            const result = await fileFBCADProtest(client);
            console.log('\nFiling Result:', JSON.stringify(result, null, 2));
        })().catch(err => {
            console.error('Fatal error:', err);
            process.exit(1);
        });
        
    } else {
        console.log(`
OverAssessed Auto-Filing System
================================
Commands:
  node auto-file.js fbcad [caseId]     File via FBCAD eFile portal (default: OA-0010)
  node auto-file.js help               Show this help

Environment:
  AUTO_FILE_DRY_RUN=true|false          Dry run mode (default: true — fills form but doesn't submit)
        `);
    }
}

module.exports = {
    prepareFilingPackage,
    generateFilingPDF,
    fileFBCADProtest,
    checkAnnualMonitoring,
    FILING_DIR,
    CONFIRMATIONS_DIR,
};
