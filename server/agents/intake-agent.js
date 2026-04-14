/**
 * IntakeAgent — validates address, resolves county, enriches property data
 * 
 * Handles: NEW_LEAD, PRE_REGISTRATION
 * Output: status → DATA_ENRICHED or NEEDS_REVIEW
 */
const BaseAgent = require('./base-agent');
const { SUPPORTED_STATES, isSupported } = require('../lib/supported-states');
const { supabaseAdmin } = require('../lib/supabase');

class IntakeAgent extends BaseAgent {
    constructor() {
        super('IntakeAgent');
    }

    canHandle(taskType) {
        return ['NEW_LEAD', 'PRE_REGISTRATION', 'ENRICH_DATA'].includes(taskType);
    }

    async execute(task, ctx) {
        const sub = await this.getSubmission(task.caseId);
        if (!sub) throw new Error(`Case ${task.caseId} not found`);

        // Step 1: Validate address completeness
        const addressIssues = this.validateAddress(sub);
        if (addressIssues.length > 0) {
            await this.updateSubmission(task.caseId, {
                status: 'NEEDS_REVIEW',
                notes: this.appendNote(sub.notes, `IntakeAgent: Address issues — ${addressIssues.join(', ')}`)
            });
            return { summary: `Address validation failed: ${addressIssues.join(', ')}`, nextAction: 'MANUAL_REVIEW' };
        }

        // Step 2: Resolve state
        const state = (sub.state || '').toUpperCase();
        if (!isSupported(state)) {
            await this.updateSubmission(task.caseId, {
                status: 'Out of Area',
                notes: this.appendNote(sub.notes, `IntakeAgent: State ${state || 'unknown'} not supported. Supported: ${SUPPORTED_STATES.join(', ')}`)
            });
            await this.log(task.caseId, 'out_of_area', { state });
            return { summary: `Out of area: ${state}`, nextAction: null };
        }

        // Step 3: Resolve county (if missing)
        let county = sub.county;
        if (!county && sub.property_address) {
            county = await this.resolveCounty(sub);
            if (county) {
                await this.updateSubmission(task.caseId, { county });
                await this.log(task.caseId, 'county_resolved', { county, method: 'zip_lookup' });
            }
        }

        if (!county) {
            await this.updateSubmission(task.caseId, {
                status: 'NEEDS_REVIEW',
                notes: this.appendNote(sub.notes, 'IntakeAgent: Could not resolve county')
            });
            return { summary: 'County resolution failed', nextAction: 'MANUAL_REVIEW' };
        }

        // Step 4: Enrich property data (sqft, beds, baths, year, assessed value)
        const enrichResult = await this.enrichProperty(sub, county);

        // Step 5: Update submission with enriched data
        const updates = {
            status: 'Data Enrichment',
            county: county,
            address_validated: true,
            ...(enrichResult.sqft && !sub.sqft ? { sqft: enrichResult.sqft } : {}),
            ...(enrichResult.bedrooms && !sub.bedrooms ? { bedrooms: enrichResult.bedrooms } : {}),
            ...(enrichResult.bathrooms && !sub.bathrooms ? { bathrooms: enrichResult.bathrooms } : {}),
            ...(enrichResult.year_built && !sub.year_built ? { year_built: enrichResult.year_built } : {}),
            ...(enrichResult.assessed_value && !sub.assessed_value ? { assessed_value: enrichResult.assessed_value } : {}),
            ...(enrichResult.lot_size && !sub.lot_size ? { lot_size: enrichResult.lot_size } : {}),
        };

        await this.updateSubmission(task.caseId, updates);
        await this.log(task.caseId, 'data_enriched', {
            county,
            fields_enriched: Object.keys(updates).filter(k => k !== 'status' && k !== 'county' && k !== 'address_validated'),
            source: enrichResult.source || 'unknown'
        });

        return {
            summary: `Enriched: county=${county}, fields=${Object.keys(updates).length - 3}`,
            nextAction: 'ANALYZE',
            data: { county, ...enrichResult }
        };
    }

    validateAddress(sub) {
        const issues = [];
        if (!sub.property_address && !sub.street) issues.push('No address');
        if (!sub.state) issues.push('No state');
        // ZIP required for county resolution
        const addr = sub.property_address || '';
        const hasZip = /\d{5}/.test(addr) || sub.zip;
        if (!hasZip) issues.push('No ZIP code');
        return issues;
    }

    async resolveCounty(sub) {
        // Try ZIP-based lookup first (fast, reliable)
        const zip = sub.zip || (sub.property_address || '').match(/\d{5}/)?.[0];
        if (!zip) return null;

        try {
            // Use existing county lookup from server
            const { getCountyFromZip } = require('../county-timeline');
            if (typeof getCountyFromZip === 'function') {
                return getCountyFromZip(zip);
            }
        } catch (e) {
            // Fallback: check if county is in the address string
            const addr = (sub.property_address || '').toLowerCase();
            const knownCounties = ['bexar', 'tarrant', 'dallas', 'harris', 'travis', 'collin', 'denton', 'williamson', 'fort bend', 'montgomery', 'hays', 'comal', 'el paso'];
            for (const c of knownCounties) {
                if (addr.includes(c)) return c.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
            }
        }
        return null;
    }

    async enrichProperty(sub, county) {
        // Placeholder: will call Rentcast/local CAD data
        // For now, returns what we already have
        return {
            sqft: sub.sqft || null,
            bedrooms: sub.bedrooms || null,
            bathrooms: sub.bathrooms || null,
            year_built: sub.year_built || null,
            assessed_value: sub.assessed_value || null,
            lot_size: sub.lot_size || null,
            source: sub.data_sources || 'existing'
        };
    }

    appendNote(existing, newNote) {
        const ts = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const prefix = `[${ts}] `;
        return existing ? `${existing} | ${prefix}${newNote}` : `${prefix}${newNote}`;
    }
}

module.exports = new IntakeAgent();
