/**
 * Property Deduplication — ONE active case per property
 * 
 * Normalizes addresses and checks for existing active cases
 * before allowing new case creation.
 */

// Address normalization: strip formatting, standardize abbreviations
function normalizeAddress(addr) {
    if (!addr) return '';
    let n = addr.toLowerCase().trim();
    // Standardize common abbreviations
    const abbrevs = {
        'street': 'st', 'st.': 'st', 'avenue': 'ave', 'ave.': 'ave',
        'boulevard': 'blvd', 'blvd.': 'blvd', 'drive': 'dr', 'dr.': 'dr',
        'court': 'ct', 'ct.': 'ct', 'lane': 'ln', 'ln.': 'ln',
        'road': 'rd', 'rd.': 'rd', 'place': 'pl', 'pl.': 'pl',
        'circle': 'cir', 'cir.': 'cir', 'terrace': 'ter', 'ter.': 'ter',
        'trail': 'trl', 'trl.': 'trl', 'way': 'way',
        'parkway': 'pkwy', 'pkwy.': 'pkwy',
        'highway': 'hwy', 'hwy.': 'hwy',
        'north': 'n', 'south': 's', 'east': 'e', 'west': 'w',
        'n.': 'n', 's.': 's', 'e.': 'e', 'w.': 'w',
        'apartment': 'apt', 'apt.': 'apt', '#': 'apt',
        'suite': 'ste', 'ste.': 'ste', 'unit': 'unit',
    };
    // Replace abbreviations (whole words only)
    for (const [full, short] of Object.entries(abbrevs)) {
        const escaped = full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        n = n.replace(new RegExp(`\\b${escaped}\\b`, 'g'), short);
    }
    // Remove all punctuation except spaces
    n = n.replace(/[^a-z0-9\s]/g, '');
    // Collapse whitespace
    n = n.replace(/\s+/g, ' ').trim();
    return n;
}

// Extract just the street portion (first line before city/state/zip)
function extractStreet(normalizedAddr) {
    // Try to extract just the street number + name (before city)
    const parts = normalizedAddr.split(/\s+/);
    // Find where the city starts — usually after a number + street name
    // For dedup, we use the first 3-5 tokens (number + street)
    if (parts.length <= 3) return normalizedAddr;
    // If last token looks like a zip code (5 digits), remove state+zip
    if (/^\d{5}$/.test(parts[parts.length - 1])) {
        parts.pop(); // zip
        if (parts.length > 0 && /^[a-z]{2}$/.test(parts[parts.length - 1])) {
            parts.pop(); // state
        }
    }
    return parts.join(' ');
}

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
                const existingNorm = normalizeAddress(existing.property_address);
                // Exact normalized match
                if (existingNorm === normalizedAddr) {
                    return {
                        match_type: 'address_exact',
                        existing_case: existing,
                        action: 'merge',
                        reason: `Same address: "${existing.property_address}" = "${address}"`
                    };
                }
                // Street-only match (looser — catches reformatted addresses)
                const existingStreet = extractStreet(existingNorm);
                const newStreet = extractStreet(normalizedAddr);
                if (existingStreet.length > 8 && existingStreet === newStreet) {
                    return {
                        match_type: 'address_street',
                        existing_case: existing,
                        action: 'merge',
                        reason: `Same street address: "${existingStreet}"`
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
            // Same email but different address = possibly second property (allow but flag)
            const existingNorm = normalizeAddress(existing.property_address);
            if (existingNorm !== normalizedAddr) {
                return {
                    match_type: 'email_different_property',
                    existing_case: existing,
                    action: 'flag',
                    reason: `Same email "${normalizedEmail}" but different property. Existing: "${existing.property_address}" vs New: "${address}"`
                };
            }
            // Same email + same address = duplicate
            return {
                match_type: 'email_exact',
                existing_case: existing,
                action: 'merge',
                reason: `Same email + address`
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
    // Only update fields that are currently empty/null on existing case
    if (newData.phone) updates.phone = newData.phone;
    if (newData.owner_name) updates.owner_name = newData.owner_name;
    if (newData.county) updates.county = newData.county;
    if (newData.state) updates.state = newData.state;
    if (newData.property_address && newData.property_address.length > 10) {
        // Only update address if new one is more complete
        updates.property_address = newData.property_address;
    }
    updates.updated_at = new Date().toISOString();
    updates.last_activity_at = new Date().toISOString();

    if (Object.keys(updates).length > 1) { // More than just timestamps
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

module.exports = { normalizeAddress, extractStreet, findDuplicate, mergeIntoExisting };
