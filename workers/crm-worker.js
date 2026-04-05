/**
 * CRM WORKER — Stage transitions, message generation, evidence enforcement
 * 
 * HARD RULES:
 *   - ALL outbound messages go to message_queue with status=pending_approval
 *   - NO auto-send under any condition
 *   - Stage transitions enforce: QA passed, real comps, agreement verified
 *   - Messages must use approved templates with verified data only
 * 
 * Job types:
 *   - stage_transition: validate + move lead between stages
 *   - generate_message: create outbound message (enters approval queue)
 *   - check_agreement: verify agreement + payment state
 *   - send_approved: send a message that was manually approved
 */

// ── MESSAGE TEMPLATES ────────────────────────────────────
// All templates are locked. No dynamic text outside these structures.

const TEMPLATES = {
    'analysis_complete_legacy': {
        id: 'analysis_complete_legacy',
        subject: 'Your Property Tax Analysis is Ready — Case {{case_id}}',
        body: `Hi {{owner_name}},

Your property tax analysis for {{property_address}} is complete.

Based on our review of {{comp_count}} comparable sales in {{county}} County, we believe your assessed value of {{assessed_value}} may be reduced.

Estimated annual savings: {{savings_range}}

As an existing client, your protest is covered under your current agreement — no additional fees to get started.

Next step: We'll prepare your filing package and keep you updated on the process.

Questions? Reply to this email or call us at (210) 760-7236.

— OverAssessed Team`,
        sms: 'OverAssessed: Your property tax analysis is ready for {{property_address}}. Estimated savings: {{savings_range}}/yr. We\'ll prepare your filing. Reply STOP to opt out.'
    },
    'analysis_complete_new': {
        id: 'analysis_complete_new',
        subject: 'Your Property Tax Analysis is Ready — Case {{case_id}}',
        body: `Hi {{owner_name}},

Your property tax analysis for {{property_address}} is complete.

Based on our review of {{comp_count}} comparable sales in {{county}} County, we believe your assessed value of {{assessed_value}} may be reduced.

Estimated annual savings: {{savings_range}}

To proceed with your protest:
1. Review and sign the fee agreement
2. Pay the $79 initiation fee (credited toward your 25% success fee)
3. We handle everything from there

Get started: {{agreement_url}}

Questions? Reply to this email or call us at (210) 760-7236.

— OverAssessed Team`,
        sms: 'OverAssessed: Your property tax analysis is ready for {{property_address}}. Estimated savings: {{savings_range}}/yr. Get started ($79): {{agreement_url}} Reply STOP to opt out.'
    },
    'no_case': {
        id: 'no_case',
        subject: 'Property Tax Review Complete — Case {{case_id}}',
        body: `Hi {{owner_name}},

We've completed our analysis of {{property_address}} in {{county}} County.

After reviewing {{comp_count}} comparable sales, your current assessed value of {{assessed_value}} appears to be in line with market data. At this time, a protest is unlikely to result in meaningful savings.

We'll continue monitoring your property. If values change or new data becomes available, we'll reach out.

No action is needed from you.

— OverAssessed Team`,
        sms: 'OverAssessed: We reviewed {{property_address}}. Your assessed value appears fair based on current comps. No action needed. We\'ll monitor for changes. Reply STOP to opt out.'
    },
    'filing_approved': {
        id: 'filing_approved',
        subject: 'Your Protest is Being Filed — Case {{case_id}}',
        body: `Hi {{owner_name}},

Great news — your property tax protest for {{property_address}} has been approved for filing.

We're submitting your protest to {{county}} County with {{comp_count}} comparable sales supporting a reduced value.

You don't need to do anything. We'll notify you when the protest is filed and again when we receive a response.

— OverAssessed Team`,
        sms: 'OverAssessed: Your property tax protest for {{property_address}} is being filed with {{county}} County. We\'ll keep you updated. Reply STOP to opt out.'
    }
};

// ── TEMPLATE RENDERER ────────────────────────────────────

function renderTemplate(templateId, data) {
    const tmpl = TEMPLATES[templateId];
    if (!tmpl) throw new Error(`Unknown template: ${templateId}`);

    const render = (text) => {
        return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
            return data[key] !== undefined ? String(data[key]) : match;
        });
    };

    return {
        template_id: templateId,
        subject: render(tmpl.subject),
        body_text: render(tmpl.body),
        sms_text: render(tmpl.sms)
    };
}

// ── EVIDENCE CHECKS ──────────────────────────────────────

function validateEvidence(lead) {
    const errors = [];

    // QA must be passed
    if (lead.qa_status !== 'passed') {
        errors.push('QA not passed');
    }

    // Comps must be real
    const comps = lead.comp_results?.comps || [];
    const realComps = comps.filter(c => c.source !== 'synthetic' && c.source !== 'synthetic-estimate');
    if (realComps.length < 3) {
        errors.push(`Only ${realComps.length} real comps (minimum 3)`);
    }

    // Comps must have sale dates
    const withDates = realComps.filter(c => c.sale_date);
    if (withDates.length < 3) {
        errors.push(`Only ${withDates.length} comps with sale dates (minimum 3)`);
    }

    // Agreement type must be set
    if (!lead.agreement_type) {
        errors.push('Agreement type not set (legacy_terms or new_terms)');
    }

    return { valid: errors.length === 0, errors };
}

function validateForFiling(lead) {
    const base = validateEvidence(lead);

    // Filing gate
    if (lead.agreement_type === 'new_terms') {
        if (!lead.fee_agreement_signed) base.errors.push('Agreement not signed');
        if (!lead.initiation_paid && !lead.initiation_fee_paid) base.errors.push('Initiation fee not paid ($79)');
    }

    // Must have filing approval
    if (!lead.filing_approved) {
        base.errors.push('Filing not approved by owner');
    }

    base.valid = base.errors.length === 0;
    return base;
}

module.exports = {
    TEMPLATES,
    renderTemplate,
    validateEvidence,
    validateForFiling
};
