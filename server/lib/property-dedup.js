/**
 * Property Deduplication — ONE active case per property
 * 
 * Uses the SINGLE shared normalizeAddress from ./normalize-address.js
 * No duplicate normalization logic in this file.
 */

const { normalizeAddress, normalizeStreet, addressesMatch } = require('./normalize-address');

/**
 * Check for existing active case matching this address or email
 * 
 * @param {object} supabase - Supabase client
 * @param {string} address - Property address
 * @param {string} email - Owner email  
 * @param {string} ownerName - Owner name (optional, for logging)
 * @returns {object|null} - { match_type, existing_case, action } or null
 */
async function findDuplicate(supabase, address, email, ownerName) {
    const normalizedAddr = normalizeAddress(address);
    const normalizedEmail = (email || '').toLowerCase().trim();
    
    if (!normalizedAddr && !normalizedEmail) return null;

    // Exclude terminal statuses
    const excludeStatuses = ['Archived', 'Deleted', 'Duplicate', 'No Case'];
    
    // 1. Check by address (strongest signal)
    if (normalizedAddr) {
        const { data: allActive } = await supabase
            .from('submissions')
            .select('id, case_id, owner_name, email, property_address, status, estimated_savings, created_at')
            .not('status', 'in', `("${excludeStatuses.join('","')}")`)
            .is('deleted_at', null);
        
        if (allActive) {
            for (const existing of allActive) {
                // Use the shared addressesMatch which handles full, street-only, and street-number matching
                if (addressesMatch(address, existing.property_address)) {
                    return {
                        match_type: 'address_match',
                        existing_case: existing,
                        action: 'merge',
                        reason: `Same property: "${existing.property_address}" matches "${address}"`
                    };
                }
            }
        }
    }

    // 2. Check by email (same person, possibly different property)
    if (normalizedEmail) {
        const { data: byEmail } = await supabase
            .from('submissions')
            .select('id, case_id, owner_name, email, property_address, status, estimated_savings, created_at')
            .eq('email', normalizedEmail)
            .not('status', 'in', `("${excludeStatuses.join('","')}")`)
            .is('deleted_at', null)
            .limit(1);
        
        if (byEmail && byEmail.length > 0) {
            const existing = byEmail[0];
            // Same email + same address = duplicate
            if (addressesMatch(address, existing.property_address)) {
                return {
                    match_type: 'email_and_address',
                    existing_case: existing,
                    action: 'merge',
                    reason: `Same email + address`
                };
            }
            // Same email but different address = possibly second property (flag, don't block)
            return {
                match_type: 'email_different_property',
                existing_case: existing,
                action: 'flag',
                reason: `Same email "${normalizedEmail}" but different property. Existing: "${existing.property_address}" vs New: "${address}"`
            };
        }
    }

    return null; // No duplicate found
}

/**
 * Merge new data into existing case (update with better info)
 */
async function mergeIntoExisting(supabase, existingCaseId, newData) {
    const updates = {};
    // Only update fields that improve the existing record
    if (newData.phone) updates.phone = newData.phone;
    if (newData.owner_name) updates.owner_name = newData.owner_name;
    if (newData.county) updates.county = newData.county;
    if (newData.state) updates.state = newData.state;
    if (newData.property_address && newData.property_address.length > 10) {
        updates.property_address = newData.property_address;
    }
    updates.updated_at = new Date().toISOString();
    updates.last_activity_at = new Date().toISOString();

    if (Object.keys(updates).length > 2) { // More than just timestamps
        await supabase.from('submissions').update(updates).eq('case_id', existingCaseId);
    }

    // Log the merge
    await supabase.from('activity_log').insert({
        case_id: existingCaseId,
        actor: 'system',
        action: 'duplicate_merged',
        details: {
            source: newData.source || 'unknown',
            new_email: newData.email,
            new_address: newData.property_address,
            fields_updated: Object.keys(updates).filter(k => k !== 'updated_at' && k !== 'last_activity_at')
        }
    });

    return updates;
}

module.exports = { findDuplicate, mergeIntoExisting };
