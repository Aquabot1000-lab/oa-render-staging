// Unified notification engine — respects customer preference
// notificationPref: 'sms', 'email', or 'both'

const STAGE_MESSAGES = {
    TX: {
        submitted: {
            subject: 'Welcome to OverAssessed',
            sms: 'Thanks for choosing OverAssessed! We\'ve received your property info and are reviewing it now. Case ID: {{caseId}}',
            email_title: 'Welcome to OverAssessed',
            email_subtitle: 'Your property tax protest is underway'
        },
        analysis_started: {
            subject: 'Analyzing Your Property',
            sms: 'We\'re analyzing your property now. You\'ll hear from us shortly! Case: {{caseId}}',
            email_title: 'Analyzing Your Property',
            email_subtitle: 'Case {{caseId}}'
        },
        analysis_complete: {
            subject: 'Your Free Analysis is Ready!',
            sms: '📊 Great news! Your property tax analysis is ready. Estimated savings: {{savings}}. View it here: {{portalUrl}}',
            email_title: 'Your Analysis is Ready! 📊',
            email_subtitle: 'Case {{caseId}}'
        },
        sign_reminder: {
            subject: 'Don\'t Miss Your Tax Savings',
            sms: '⏰ Reminder: Sign your authorization to start your property tax protest. {{signUrl}}',
            email_title: 'Quick Reminder',
            email_subtitle: 'Case {{caseId}}'
        },
        docs_signed: {
            subject: 'Authorization Received — Filing Soon',
            sms: '✅ We received your signed authorization! We\'re preparing to file your protest with {{county}} appraisal district.',
            email_title: 'Authorization Confirmed ✓',
            email_subtitle: 'Case {{caseId}}'
        },
        filed: {
            subject: 'Your Protest Has Been Filed!',
            sms: '📤 Your property tax protest has been filed with {{county}}! We\'ll handle everything from here.',
            email_title: 'Your Protest Has Been Filed! 📤',
            email_subtitle: 'Case {{caseId}}'
        },
        hearing_scheduled: {
            subject: 'Hearing Scheduled',
            sms: '🏛️ Your hearing is scheduled for {{hearingDate}}. We\'ll represent you — no need to attend.',
            email_title: 'Your Hearing is Scheduled 🏛️',
            email_subtitle: 'Case {{caseId}}'
        },
        won: {
            subject: 'Great News — Your Taxes Are Reduced!',
            sms: '🎉 Your property value was reduced! You\'re saving {{savings}}/year. Invoice details coming soon.',
            email_title: 'Great News — Your Taxes Are Reduced! 🎉',
            email_subtitle: 'Case {{caseId}}'
        },
        no_change: {
            subject: 'Appeal Result',
            sms: 'Unfortunately, no reduction was achieved for your property at {{propertyAddress}}. You owe nothing. We appreciate your trust.',
            email_title: 'Appeal Result',
            email_subtitle: 'Case {{caseId}}'
        },
        invoice_sent: {
            subject: 'Invoice for Tax Savings Services',
            sms: '📄 Your invoice for {{invoiceAmount}} (25% of {{savings}} savings) is ready: {{invoiceUrl}}',
            email_title: 'Your Invoice is Ready 📄',
            email_subtitle: 'Case {{caseId}}'
        },
        payment_received: {
            subject: 'Payment Received — Thank You!',
            sms: '✅ Payment received. Thank you for choosing OverAssessed!',
            email_title: 'Payment Received ✅',
            email_subtitle: 'Case {{caseId}}'
        }
    },
    GA: {
        submitted: {
            subject: 'Welcome to OverAssessed',
            sms: 'Thanks for choosing OverAssessed! We\'ve received your property info and are reviewing it now. Case ID: {{caseId}}',
            email_title: 'Welcome to OverAssessed',
            email_subtitle: 'Your property tax appeal is underway'
        },
        analysis_started: {
            subject: 'Analyzing Your Property',
            sms: 'We\'re analyzing your Georgia property now. You\'ll hear from us shortly! Case: {{caseId}}',
            email_title: 'Analyzing Your Property',
            email_subtitle: 'Case {{caseId}}'
        },
        analysis_complete: {
            subject: 'Your Free Analysis is Ready!',
            sms: '📊 Great news! Your property tax analysis is ready. Estimated savings: {{savings}}. View it here: {{portalUrl}}',
            email_title: 'Your Analysis is Ready! 📊',
            email_subtitle: 'Case {{caseId}}'
        },
        sign_reminder: {
            subject: 'Don\'t Miss Your Tax Savings',
            sms: '⏰ Reminder: Sign your Letter of Authorization to start your property tax appeal. {{signUrl}}',
            email_title: 'Quick Reminder',
            email_subtitle: 'Case {{caseId}}'
        },
        docs_signed: {
            subject: 'Authorization Received — Filing Soon',
            sms: '✅ We received your signed authorization! We\'re preparing to file your appeal with {{county}} County.',
            email_title: 'Authorization Confirmed ✓',
            email_subtitle: 'Case {{caseId}}'
        },
        filed: {
            subject: 'Your Appeal Has Been Filed!',
            sms: '📤 Your property tax appeal (PT-311A) has been filed with {{county}} County Board of Tax Assessors! We handle everything from here.',
            email_title: 'Your Appeal Has Been Filed! 📤',
            email_subtitle: 'Case {{caseId}}'
        },
        hearing_scheduled: {
            subject: 'Board of Equalization Hearing Scheduled',
            sms: '🏛️ Your Board of Equalization hearing is scheduled for {{hearingDate}}. We\'ll represent you — no need to attend.',
            email_title: 'Board of Equalization Hearing Scheduled 🏛️',
            email_subtitle: 'Case {{caseId}}'
        },
        won: {
            subject: 'Great News — Your Taxes Are Reduced!',
            sms: '🎉 Your assessed value was reduced! You\'re saving {{savings}}/year — and your value is frozen for 3 years! Invoice details coming soon.',
            email_title: 'Great News — Your Taxes Are Reduced! 🎉',
            email_subtitle: 'Case {{caseId}}'
        },
        no_change: {
            subject: 'Appeal Result',
            sms: 'Unfortunately, no reduction was achieved for your property at {{propertyAddress}}. You owe nothing. We appreciate your trust.',
            email_title: 'Appeal Result',
            email_subtitle: 'Case {{caseId}}'
        },
        invoice_sent: {
            subject: 'Invoice for Tax Savings Services',
            sms: '📄 Your invoice for {{invoiceAmount}} (25% of {{savings}} savings) is ready: {{invoiceUrl}}',
            email_title: 'Your Invoice is Ready 📄',
            email_subtitle: 'Case {{caseId}}'
        },
        payment_received: {
            subject: 'Payment Received — Thank You!',
            sms: '✅ Payment received. Thank you for choosing OverAssessed!',
            email_title: 'Payment Received ✅',
            email_subtitle: 'Case {{caseId}}'
        }
    }
};

// GA counties list for state detection
const GA_COUNTIES = [
    'Fulton', 'DeKalb', 'Gwinnett', 'Cobb', 'Cherokee', 'Forsyth',
    'Douglas', 'Henry', 'Clayton', 'Paulding', 'Fayette', 'Rockdale',
    'Newton', 'Barrow', 'Walton', 'Hall', 'Jackson', 'Bartow',
    'Carroll', 'Coweta', 'Spalding', 'Morgan', 'Oconee', 'Clarke',
    'Bibb', 'Chatham', 'Richmond', 'Muscogee', 'Columbia', 'Houston'
];

const WA_COUNTIES = [
    'King', 'Pierce', 'Snohomish', 'Clark', 'Spokane', 'Thurston',
    'Kitsap', 'Whatcom', 'Benton', 'Yakima', 'Skagit', 'Island',
    'Cowlitz', 'Grant', 'Lewis', 'Mason', 'Grays Harbor', 'Clallam',
    'Walla Walla', 'Chelan', 'Franklin', 'San Juan', 'Jefferson'
];

const AZ_COUNTIES = [
    'Maricopa', 'Pima', 'Pinal', 'Yavapai', 'Coconino', 'Mohave',
    'Yuma', 'Cochise', 'Navajo', 'Apache', 'Gila', 'Graham',
    'Santa Cruz', 'La Paz', 'Greenlee'
];

const CO_COUNTIES = [
    'Denver', 'El Paso', 'Arapahoe', 'Jefferson', 'Adams', 'Douglas',
    'Larimer', 'Boulder', 'Weld', 'Mesa', 'Pueblo', 'Broomfield',
    'Eagle', 'Pitkin', 'Summit', 'Garfield', 'Routt', 'San Miguel'
];

function detectState(source, county, explicitState, address) {
    // 1. Explicit state from form always wins
    if (explicitState && ['TX', 'GA', 'WA', 'AZ', 'CO'].includes(explicitState.toUpperCase())) {
        return explicitState.toUpperCase();
    }
    // 2. Detect from source string
    if (source) {
        const s = source.toLowerCase();
        if (s.includes('ga') || s.includes('georgia')) return 'GA';
        if (s.includes('wa') || s.includes('washington')) return 'WA';
        if (s.includes('az') || s.includes('arizona')) return 'AZ';
        if (s.includes('co') || s.includes('colorado')) return 'CO';
    }
    // 3. Detect from county name
    if (county) {
        const c = (county || '').toLowerCase();
        if (GA_COUNTIES.some(gc => gc.toLowerCase() === c)) return 'GA';
        if (WA_COUNTIES.some(wc => wc.toLowerCase() === c)) return 'WA';
        if (AZ_COUNTIES.some(ac => ac.toLowerCase() === c)) return 'AZ';
        if (CO_COUNTIES.some(cc => cc.toLowerCase() === c)) return 'CO';
    }
    // 4. Detect from address
    if (address) {
        const a = address.toLowerCase();
        // GA patterns
        if (/, ga\b|georgia/i.test(a) || /atlanta|fulton|dekalb|gwinnett|cobb/i.test(a)) return 'GA';
        // WA patterns
        if (/, wa\b|washington/i.test(a) || /seattle|king county|snohomish|pierce|spokane/i.test(a)) return 'WA';
        // AZ patterns
        if (/, az\b|arizona/i.test(a) || /phoenix|scottsdale|mesa|tempe|chandler|maricopa/i.test(a)) return 'AZ';
        // CO patterns
        if (/, co\b|colorado/i.test(a) || /denver|boulder|colorado springs|aurora|fort collins/i.test(a)) return 'CO';
    }
    // 5. Default TX only as absolute last resort
    return 'TX';
}

function fillTemplate(template, vars) {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
    }
    return result;
}

function getTemplateVars(submission, extras = {}) {
    const baseUrl = process.env.BASE_URL || 'https://overassessed.ai';
    return {
        caseId: submission.caseId || '',
        savings: submission.estimatedSavings ? '$' + submission.estimatedSavings.toLocaleString() : (extras.savings ? '$' + extras.savings : ''),
        portalUrl: `${baseUrl}/portal`,
        signUrl: `${baseUrl}/sign/${submission.caseId}`,
        county: submission.county || '',
        propertyAddress: submission.propertyAddress || '',
        hearingDate: extras.hearingDate || '',
        invoiceAmount: extras.invoiceAmount || '',
        invoiceUrl: extras.invoiceUrl || ''
    };
}

/**
 * Send a stage notification to the client, respecting their notification preference.
 * @param {Object} submission - The submission object
 * @param {string} stage - One of the stage keys (submitted, analysis_complete, etc.)
 * @param {Object} extras - Additional template variables
 * @param {Function} sendClientSMS - SMS sending function
 * @param {Function} sendClientEmail - Email sending function
 * @param {Function} brandedEmailWrapper - Email wrapper function
 */
async function sendStageNotification(submission, stage, extras, { sendClientSMS, sendClientEmail, brandedEmailWrapper }) {
    const state = submission.state || 'TX';
    const pref = submission.notificationPref || 'both';
    const messages = STAGE_MESSAGES[state] && STAGE_MESSAGES[state][stage];
    if (!messages) {
        console.log(`[Notifications] No template for state=${state} stage=${stage}`);
        return;
    }

    const vars = getTemplateVars(submission, extras);
    const smsText = fillTemplate(messages.sms, vars);
    const subject = fillTemplate(messages.subject, vars);

    // Build email body
    // Build richer email body for specific stages, plain SMS-to-HTML for others
    let emailBody;
    if (stage === 'analysis_complete') {
        emailBody = `
            <p style="color: #2d3436;">Hi ${submission.ownerName},</p>
            <p style="color: #2d3436;">Great news — our team has completed the analysis for your property at <strong>${vars.propertyAddress || 'your address'}</strong>.</p>
            <p style="color: #2d3436;">Log into your portal to view the full report and sign the authorization form:</p>
            <div style="text-align: center; margin: 24px 0;">
                <a href="${vars.signUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #6c5ce7, #0984e3); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">Sign Authorization & View Report</a>
            </div>
            ${vars.savings ? `<p style="color: #2d3436;"><strong>Estimated savings: ${vars.savings}/year</strong></p>` : ''}
            <p style="color: #6b7280; font-size: 13px;">If the button doesn't work, copy this link: ${vars.signUrl}</p>`;
    } else {
        emailBody = `<p style="color: #2d3436;">Hi ${submission.ownerName},</p><p style="color: #2d3436;">${smsText.replace(/\n/g, '</p><p style="color: #2d3436;">')}</p>`;
    }
    const emailHtml = brandedEmailWrapper(
        fillTemplate(messages.email_title, vars),
        fillTemplate(messages.email_subtitle, vars),
        emailBody
    );

    if (pref === 'sms' || pref === 'both') {
        if (submission.phone) {
            sendClientSMS(submission.phone, smsText);
        }
    }
    if (pref === 'email' || pref === 'both') {
        if (submission.email) {
            sendClientEmail(submission.email, `${subject} — ${submission.caseId}`, emailHtml);
        }
    }

    console.log(`[Notifications] Sent stage=${stage} state=${state} pref=${pref} to ${submission.caseId}`);
}

// ─── Filing-Specific Email Notifications ─────────────────────
const FILING_EMAIL_TEMPLATES = {
    filing_created: {
        subject: 'Your Property Tax Filing Has Been Created',
        title: 'Filing Created',
        body: `<p>Hi {{name}},</p>
            <p>We've created your property tax filing for <strong>{{propertyAddress}}</strong> in <strong>{{county}}</strong> County.</p>
            <p><strong>Next steps:</strong></p>
            <ul><li>We'll prepare your authorization form (Form 50-162)</li><li>You'll receive it for electronic signature</li><li>Once signed, we'll file your protest automatically</li></ul>
            <p>We'll keep you updated every step of the way.</p>`
    },
    form_ready: {
        subject: 'Sign Your Authorization Form ✍️',
        title: 'Your Form is Ready',
        body: `<p>Hi {{name}},</p>
            <p>Your authorization form is ready for signature. This form allows us to represent you in your property tax protest for <strong>{{propertyAddress}}</strong>.</p>
            <p><a href="{{portalUrl}}" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#6c5ce7,#0984e3);color:white;text-decoration:none;border-radius:8px;font-weight:600;">Sign Your Form</a></p>
            <p>Once signed, we'll handle everything from filing to hearing.</p>`
    },
    filed: {
        subject: 'Your Protest Has Been Filed! 📤',
        title: 'Protest Filed',
        body: `<p>Hi {{name}},</p>
            <p>Great news! Your property tax protest has been officially filed with the <strong>{{county}}</strong> County Appraisal District.</p>
            <p><strong>Confirmation:</strong> {{confirmationNumber}}</p>
            <p>Our team will represent you from here. You'll be notified when a hearing is scheduled.</p>`
    },
    hearing_scheduled: {
        subject: 'Your Hearing is Scheduled 🏛️',
        title: 'Hearing Scheduled',
        body: `<p>Hi {{name}},</p>
            <p>A hearing has been scheduled for your property tax protest:</p>
            <ul><li><strong>Property:</strong> {{propertyAddress}}</li><li><strong>Date:</strong> {{hearingDate}}</li><li><strong>Type:</strong> {{hearingType}}</li><li><strong>Format:</strong> {{hearingFormat}}</li></ul>
            <p>Our team will represent you — no action needed on your part. We'll prepare and present your evidence.</p>`
    },
    settlement_offer: {
        subject: 'We Received a Settlement Offer 💰',
        title: 'Settlement Offer',
        body: `<p>Hi {{name}},</p>
            <p>We've received a settlement offer for <strong>{{propertyAddress}}</strong>:</p>
            <p style="font-size:1.5rem;font-weight:700;color:#6c5ce7;">{{settlementOffer}}</p>
            <p>Original assessed value: {{originalValue}}</p>
            <p>Please log into your portal to review and accept or decline this offer.</p>
            <p><a href="{{portalUrl}}" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#6c5ce7,#0984e3);color:white;text-decoration:none;border-radius:8px;font-weight:600;">Review Offer</a></p>`
    },
    case_closed: {
        subject: 'Your Case is Closed — Here Are Your Results ✅',
        title: 'Case Closed',
        body: `<p>Hi {{name}},</p>
            <p>Your property tax protest for <strong>{{propertyAddress}}</strong> has been resolved!</p>
            <p><strong>Results:</strong></p>
            <ul><li>Original Value: {{originalValue}}</li><li>Final Value: {{finalValue}}</li><li><strong>Total Savings: {{savings}}</strong></li></ul>
            <p>Thank you for choosing OverAssessed. We'll monitor your property and reach out if values increase next year.</p>`
    }
};

/**
 * Send a filing-stage email directly via SendGrid.
 * @param {string} toEmail 
 * @param {string} stage - one of: filing_created, form_ready, filed, hearing_scheduled, settlement_offer, case_closed
 * @param {object} vars - template variables: name, propertyAddress, county, confirmationNumber, etc.
 */
async function sendFilingNotification(toEmail, stage, vars = {}) {
    const template = FILING_EMAIL_TEMPLATES[stage];
    if (!template || !toEmail) return;

    try {
        const sgMail = require('@sendgrid/mail');
        if (!process.env.SENDGRID_API_KEY) {
            console.log(`[FilingNotification] No SendGrid key, skipping ${stage} to ${toEmail}`);
            return;
        }
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);

        const fill = (str) => {
            let result = str;
            for (const [k, v] of Object.entries(vars)) {
                result = result.replace(new RegExp(`{{${k}}}`, 'g'), v || '');
            }
            return result;
        };

        const subject = fill(template.subject);
        const html = `
            <div style="font-family:'Inter',sans-serif;max-width:600px;margin:0 auto;background-color:#ffffff;">
                <div style="background-color:#6c5ce7;background:linear-gradient(135deg,#6c5ce7,#0984e3);padding:2rem;text-align:center;border-radius:12px 12px 0 0;">
                    <h1 style="color:#ffffff;margin:0;font-size:1.5rem;">${fill(template.title)}</h1>
                </div>
                <div style="padding:2rem;background-color:#ffffff;color:#2d3436;border:1px solid #eee;border-radius:0 0 12px 12px;">
                    ${fill(template.body)}
                    <hr style="border:none;border-top:1px solid #eee;margin:2rem 0;">
                    <p style="font-size:0.8rem;color:#999;text-align:center;">OverAssessed, LLC | 6002 Camp Bullis, Suite 208, San Antonio, TX 78257<br>
                    <a href="mailto:info@overassessed.ai" style="color:#6c5ce7;">info@overassessed.ai</a></p>
                </div>
            </div>`;

        await sgMail.send({
            to: toEmail,
            from: { email: 'notifications@overassessed.ai', name: 'OverAssessed' },
            subject,
            html
        });
        console.log(`[FilingNotification] Sent ${stage} to ${toEmail}`);
    } catch (err) {
        console.error(`[FilingNotification] Error sending ${stage}:`, err.message);
    }
}

module.exports = {
    STAGE_MESSAGES,
    GA_COUNTIES,
    WA_COUNTIES,
    AZ_COUNTIES,
    CO_COUNTIES,
    detectState,
    fillTemplate,
    getTemplateVars,
    sendStageNotification,
    sendFilingNotification,
    FILING_EMAIL_TEMPLATES
};
