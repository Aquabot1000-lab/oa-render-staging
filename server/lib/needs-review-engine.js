/**
 * Needs Review Resolution Engine
 * 
 * Classifies every NEEDS_REVIEW case into a specific issue type
 * and triggers appropriate automatic outreach.
 * 
 * Issue Types:
 *   MISSING_NOTICE     → notice not uploaded, send request
 *   WRONG_DOCUMENT     → uploaded file isn't a notice, send correction request
 *   INCOMPLETE_ADDRESS → address too short to resolve, request full address
 *   COUNTY_UNRESOLVED  → has address but county couldn't be determined
 *   HIGH_VALUE_REVIEW  → savings ≥ $5,000, escalate to Tyler
 */

// Known county lookup by city/zip for supported states
const COUNTY_LOOKUP = {
    // WA
    'burien': 'King', 'seattle': 'King', 'bellevue': 'King', 'kent': 'King',
    'renton': 'King', 'redmond': 'King', 'kirkland': 'King', 'bothell': 'King',
    'tacoma': 'Pierce', 'lakewood': 'Pierce', 'puyallup': 'Pierce',
    'spokane': 'Spokane', 'vancouver': 'Clark', 'olympia': 'Thurston',
    'yakima': 'Yakima', 'kennewick': 'Benton', 'everett': 'Snohomish',
    // CO
    'montrose': 'Montrose', 'denver': 'Denver', 'colorado springs': 'El Paso',
    'aurora': 'Arapahoe', 'fort collins': 'Larimer', 'boulder': 'Boulder',
    'pueblo': 'Pueblo', 'lakewood': 'Jefferson', 'thornton': 'Adams',
    // TX
    'san antonio': 'Bexar', 'austin': 'Travis', 'houston': 'Harris',
    'dallas': 'Dallas', 'fort worth': 'Tarrant', 'plano': 'Collin',
    'frisco': 'Collin', 'denton': 'Denton', 'round rock': 'Williamson',
    'mckinney': 'Collin', 'allen': 'Collin', 'argyle': 'Denton',
    // GA
    'atlanta': 'Fulton', 'marietta': 'Cobb', 'decatur': 'DeKalb',
    'savannah': 'Chatham', 'athens': 'Clarke', 'roswell': 'Fulton',
    // AZ
    'phoenix': 'Maricopa', 'tucson': 'Pima', 'mesa': 'Maricopa',
    'scottsdale': 'Maricopa', 'chandler': 'Maricopa', 'tempe': 'Maricopa',
};

/**
 * Try to resolve county from address using city lookup
 */
function resolveCounty(address) {
    if (!address) return null;
    const lower = address.toLowerCase();
    for (const [city, county] of Object.entries(COUNTY_LOOKUP)) {
        if (lower.includes(city)) return county;
    }
    return null;
}

/**
 * Classify a Needs Review case into specific issue type
 */
function classifyIssue(caseData) {
    const hasNotice = !!caseData.notice_url;
    const wrongDoc = (caseData.notes || '').includes('WRONG') || 
                     (caseData.upload_status || '').includes('wrong') ||
                     (caseData.notes || '').includes('wrong_document');
    const address = caseData.property_address || '';
    const hasFullAddress = address.length >= 15;
    const hasCounty = !!caseData.county;
    const savings = caseData.estimated_savings || 0;
    const highValue = savings >= 5000;

    // Priority order matters
    if (wrongDoc) {
        return {
            type: 'WRONG_DOCUMENT',
            priority: highValue ? 'CRITICAL' : 'HIGH',
            description: 'Uploaded file is not a valid Notice of Appraised Value',
            escalate: highValue
        };
    }
    if (!hasFullAddress) {
        return {
            type: 'INCOMPLETE_ADDRESS',
            priority: 'MEDIUM',
            description: `Address too short to process: "${address}"`,
            escalate: false
        };
    }
    if (!hasCounty) {
        // Try to auto-resolve
        const resolved = resolveCounty(address);
        if (resolved) {
            return {
                type: 'COUNTY_AUTO_RESOLVED',
                priority: 'LOW',
                description: `County resolved to ${resolved} from address`,
                resolvedCounty: resolved,
                escalate: false
            };
        }
        return {
            type: 'COUNTY_UNRESOLVED',
            priority: 'MEDIUM',
            description: 'County could not be determined from address',
            escalate: false
        };
    }
    if (highValue) {
        return {
            type: 'HIGH_VALUE_REVIEW',
            priority: 'CRITICAL',
            description: `High value case ($${savings.toLocaleString()}/yr) needs review`,
            escalate: true
        };
    }
    if (!hasNotice) {
        return {
            type: 'MISSING_NOTICE',
            priority: savings > 0 ? 'HIGH' : 'NORMAL',
            description: 'Notice of Appraised Value not yet uploaded',
            escalate: false
        };
    }
    // Has notice, has county, not wrong doc, not high value → shouldn't be in Needs Review
    return {
        type: 'READY_TO_ADVANCE',
        priority: 'LOW',
        description: 'Case appears ready to advance from Needs Review',
        escalate: false
    };
}

/**
 * Generate outreach templates based on issue type
 */
function getOutreachTemplates(caseData, issue) {
    const firstName = (caseData.owner_name || '').split(' ')[0] || 'there';
    const address = caseData.property_address || 'your property';
    const county = caseData.county || '';
    const caseId = caseData.case_id || '';

    const templates = {
        WRONG_DOCUMENT: {
            sms: `Hi ${firstName}, we received your upload for your property tax case but it doesn't appear to be a Notice of Appraised Value. Could you re-upload the correct document? It's the notice from ${county || 'your'} County showing your assessed value. Upload here: https://overassessed.ai/upload — takes 30 seconds.`,
            emailSubject: `Action Needed: Please Re-Upload Your Notice — ${caseId}`,
            emailBody: `Hi ${firstName},\n\nThank you for uploading a document for your property at ${address}. However, the file doesn't appear to be a Notice of Appraised Value from ${county || 'your'} County.\n\nThe Notice of Appraised Value is typically a letter from your county appraisal district showing your property's assessed/market value for the current tax year. It's usually mailed in April-May.\n\nPlease re-upload the correct document here:\nhttps://overassessed.ai/upload\n\nIf you're unsure which document to upload, just reply to this email and we'll help.\n\nBest,\nOverAssessed Team`
        },
        MISSING_NOTICE: {
            sms: `Hi ${firstName}, this is OverAssessed. To move forward with your property tax protest for ${address}, we need your Notice of Appraised Value from ${county || 'your'} County. Upload it here: https://overassessed.ai/upload — takes 30 seconds.`,
            emailSubject: `Upload Your Notice to Start Saving — ${caseId}`,
            emailBody: `Hi ${firstName},\n\nWe're ready to analyze your property at ${address} for potential tax savings.\n\nTo proceed, we need your Notice of Appraised Value from ${county || 'your'} County. This is the letter showing your property's assessed value for the current tax year.\n\nUpload it here (takes 30 seconds):\nhttps://overassessed.ai/upload\n\nHaven't received your notice yet? No problem — they typically arrive in April-May. We'll keep your case ready and notify you when it's time.\n\nBest,\nOverAssessed Team`
        },
        INCOMPLETE_ADDRESS: {
            sms: `Hi ${firstName}, this is OverAssessed. We need your full property address (street, city, state, zip) to process your tax protest case. Can you reply with the complete address?`,
            emailSubject: `We Need Your Full Address — ${caseId}`,
            emailBody: `Hi ${firstName},\n\nWe're working on your property tax case but need your complete property address to proceed.\n\nCould you reply with:\n- Full street address\n- City\n- State\n- Zip code\n\nOnce we have the full address, we can look up your property data and start the analysis.\n\nBest,\nOverAssessed Team`
        },
        COUNTY_UNRESOLVED: {
            sms: `Hi ${firstName}, this is OverAssessed. We're processing your case for ${address} but need to confirm — what county is your property in? Just reply with the county name.`,
            emailSubject: `Quick Question About Your Property — ${caseId}`,
            emailBody: `Hi ${firstName},\n\nWe're setting up your property tax protest for ${address}, but we need to confirm which county your property is in.\n\nCould you reply with the county name? This helps us file with the correct appraisal district.\n\nBest,\nOverAssessed Team`
        },
        HIGH_VALUE_REVIEW: {
            sms: `Hi ${firstName}, this is OverAssessed. We've identified significant potential savings on your property taxes at ${address}. We'd like to personally review your case. Can we schedule a quick call?`,
            emailSubject: `Significant Savings Found — Let's Review Your Case — ${caseId}`,
            emailBody: `Hi ${firstName},\n\nGreat news — our preliminary analysis of your property at ${address} shows significant potential savings on your property taxes.\n\nGiven the size of the potential savings, we'd like to personally review your case to make sure everything is optimized before we proceed.\n\nWould you have a few minutes for a quick call this week? Or just reply to this email with any questions.\n\nBest,\nOverAssessed Team`
        }
    };

    return templates[issue.type] || templates.MISSING_NOTICE;
}

module.exports = { classifyIssue, getOutreachTemplates, resolveCounty, COUNTY_LOOKUP };
