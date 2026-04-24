/**
 * case-action-router.js
 *
 * Routes case actions based on message classification
 * Updates submissions table with next action, priority, and follow-up timing
 */

/**
 * Routes a case action based on classification
 * @param {string} caseId - Case ID (e.g., OA-0001)
 * @param {string} classification - Classification from message-classifier
 * @param {Object} supabaseAdmin - Supabase admin client
 * @returns {Promise<Object>} { updated: boolean, next_action: string, next_follow_up_at: Date }
 */
async function routeCaseAction(caseId, classification, supabaseAdmin) {
    const now = new Date();
    let updates = {
        last_contact_at: now.toISOString(),
        updated_at: now.toISOString()
    };

    // Route based on classification
    switch (classification) {
        case "NOTICE_NOT_RECEIVED":
            // Follow up in 3 days to check if notice arrived
            const followUp3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
            updates.next_follow_up_at = followUp3Days.toISOString();
            updates.next_action = "Follow up: check if notice arrived";
            updates.next_action_priority = 2;

            // Only update status if not already at a higher status
            // We'll do a conditional update to avoid overwriting progress
            updates.conditional_status = "WAITING_FOR_NOTICE";
            break;

        case "WRONG_DOCUMENT":
            // Urgent: need to correct customer misunderstanding
            const followUp1Day = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
            updates.next_action = "Send correction: explain notice vs tax bill";
            updates.next_action_priority = 1;
            updates.next_follow_up_at = followUp1Day.toISOString();
            break;

        case "DOCUMENT_RECEIVED":
            // Immediate review needed
            updates.next_action = "Internal review: process uploaded document";
            updates.next_action_priority = 1;
            updates.next_follow_up_at = now.toISOString(); // Immediate
            updates.conditional_status = "NEEDS_REVIEW";
            break;

        case "SIGNATURE_PENDING":
            // Follow up on signature in 1 day
            const followUpSig = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
            updates.next_action = "Follow up: signature required";
            updates.next_action_priority = 1;
            updates.next_follow_up_at = followUpSig.toISOString();
            break;

        case "GENERAL_QUESTION":
            // Review and respond within 1 day
            const followUpQ = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
            updates.next_action = "Review and respond to customer question";
            updates.next_action_priority = 2;
            updates.next_follow_up_at = followUpQ.toISOString();
            break;

        default:
            // Unknown classification - default to general question
            const followUpDefault = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
            updates.next_action = "Review customer message";
            updates.next_action_priority = 2;
            updates.next_follow_up_at = followUpDefault.toISOString();
    }

    try {
        // Build update object
        const updateObj = {
            next_action: updates.next_action,
            next_action_priority: updates.next_action_priority,
            next_follow_up_at: updates.next_follow_up_at,
            last_contact_at: updates.last_contact_at,
            updated_at: updates.updated_at
        };

        // For conditional status updates, only update if current status allows it
        if (updates.conditional_status) {
            // First, get current status
            const { data: currentCase } = await supabaseAdmin
                .from('submissions')
                .select('status')
                .eq('case_id', caseId)
                .single();

            // Only update status if it's not already at a more advanced state
            const allowedStatuses = ['NEW', 'PENDING', null, ''];
            if (currentCase && allowedStatuses.includes(currentCase.status)) {
                updateObj.status = updates.conditional_status;
            }
        }

        // Update the submission
        const { data, error } = await supabaseAdmin
            .from('submissions')
            .update(updateObj)
            .eq('case_id', caseId);

        if (error) {
            console.error(`[CaseActionRouter] Failed to update case ${caseId}:`, error);
            return {
                updated: false,
                error: error.message
            };
        }

        console.log(`[CaseActionRouter] Updated ${caseId}: ${updates.next_action} | Follow-up: ${updates.next_follow_up_at}`);

        return {
            updated: true,
            next_action: updates.next_action,
            next_follow_up_at: updates.next_follow_up_at
        };

    } catch (err) {
        console.error(`[CaseActionRouter] Exception updating case ${caseId}:`, err);
        return {
            updated: false,
            error: err.message
        };
    }
}

module.exports = { routeCaseAction };
