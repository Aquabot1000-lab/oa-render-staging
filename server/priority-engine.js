/**
 * Priority Scoring Engine
 * Calculates 0-100 priority score for each lead
 * 
 * Components:
 *   Savings Potential:  0-40 pts
 *   Timing Urgency:     0-25 pts
 *   Data Confidence:    0-20 pts
 *   Customer Status:    0-15 pts
 */

const { getCountyStatus } = require('./county-timeline');

/**
 * Calculate savings score (0-40)
 */
function savingsScore(lead) {
  const savings = parseFloat(lead.estimated_savings || 0);
  if (savings >= 10000) return 40;
  if (savings >= 5000) return 35;
  if (savings >= 3000) return 30;
  if (savings >= 2000) return 25;
  if (savings >= 1000) return 20;
  if (savings >= 500) return 15;
  if (savings >= 200) return 10;
  if (savings >= 50) return 5;
  return 0;
}

/**
 * Calculate timing urgency (0-25)
 */
function timingScore(lead) {
  const state = (lead.state || '').trim();
  const county = (lead.county || '').trim();
  const timeline = getCountyStatus(state, county);
  const days = timeline.days_to_deadline;
  
  if (days === null || days === undefined) return 0;
  if (days < 0) return 0;      // Deadline passed — no urgency, it's over
  if (days <= 7) return 25;     // CRITICAL
  if (days <= 14) return 22;    // Very urgent
  if (days <= 21) return 18;    // Urgent
  if (days <= 30) return 14;    // Soon
  if (days <= 45) return 10;    // Approaching
  if (days <= 60) return 6;     // Moderate
  if (days <= 90) return 3;     // Plenty of time
  return 1;                     // Distant
}

/**
 * Calculate data confidence (0-20)
 */
function dataScore(lead) {
  let score = 0;
  const cr = lead.comp_results || {};
  const comps = cr.comps || [];
  
  // Has assessed value
  const assessed = parseFloat(String(lead.assessed_value || '0').replace(/[,$]/g, ''));
  if (assessed > 0) score += 5;
  
  // Comp count
  if (comps.length >= 5) score += 5;
  else if (comps.length >= 3) score += 3;
  else if (comps.length >= 1) score += 1;
  
  // All comps have sale dates
  const datedComps = comps.filter(c => c.sale_date);
  if (datedComps.length === comps.length && comps.length >= 3) score += 4;
  else if (datedComps.length >= 3) score += 2;
  
  // QA passed
  if (lead.qa_status === 'passed') score += 3;
  
  // Has property details (sqft, beds, etc)
  if (lead.sqft) score += 1;
  if (lead.year_built) score += 1;
  if (lead.bedrooms) score += 1;
  
  return Math.min(score, 20);
}

/**
 * Calculate customer status score (0-15)
 */
function customerScore(lead) {
  let score = 0;
  
  // Has contact info
  if (lead.email) score += 3;
  if (lead.phone) score += 2;
  
  // Agreement signed
  if (lead.fee_agreement_signed) score += 4;
  
  // Initiation paid
  if (lead.initiation_paid || lead.initiation_fee_paid) score += 4;
  
  // Legacy client (already engaged)
  if (lead.agreement_type === 'legacy_terms') score += 2;
  
  return Math.min(score, 15);
}

/**
 * Calculate full priority score and tag
 */
function calculatePriority(lead) {
  const savings = savingsScore(lead);
  const timing = timingScore(lead);
  const data = dataScore(lead);
  const customer = customerScore(lead);
  const total = savings + timing + data + customer;
  
  let tag;
  if (total >= 70) tag = 'HIGH';
  else if (total >= 40) tag = 'MEDIUM';
  else tag = 'LOW';
  
  return {
    score: total,
    tag,
    breakdown: { savings, timing, data, customer },
    max: { savings: 40, timing: 25, data: 20, customer: 15 }
  };
}

// ═══════════════ FOLLOW-UP ENGINE ═══════════════

/**
 * Follow-up sequence definitions
 * Each sequence has steps with delays and conditions
 */
const SEQUENCES = {
  // New lead — just arrived, analysis pending
  new_lead: {
    name: 'New Lead Intake',
    steps: [
      { delay_hours: 0, action: 'analyze', description: 'Auto-analyze lead' },
      { delay_hours: 1, action: 'check_analysis', description: 'Verify analysis complete' },
    ]
  },
  
  // Analysis complete, pending approval — waiting for Tyler
  pending_approval: {
    name: 'Pending Approval',
    steps: [
      { delay_hours: 0, action: 'generate_message', description: 'Generate outreach message' },
      { delay_hours: 24, action: 'alert_tyler', description: 'Remind Tyler to review', condition: 'still_pending' },
      { delay_hours: 72, action: 'alert_tyler', description: 'Escalate: 3 days pending', condition: 'still_pending' },
    ]
  },
  
  // Message sent, waiting for response
  awaiting_response: {
    name: 'Awaiting Response',
    steps: [
      { delay_hours: 48, action: 'generate_followup', description: 'Follow-up message', condition: 'no_response' },
      { delay_hours: 120, action: 'generate_followup', description: 'Second follow-up', condition: 'no_response' },
      { delay_hours: 240, action: 'close_cold', description: 'Mark as cold/no response', condition: 'no_response' },
    ]
  },
  
  // Waiting on county — no outreach, just monitoring
  waiting_county: {
    name: 'Waiting on County',
    steps: [
      { delay_hours: 168, action: 'check_county', description: 'Weekly county status check' },
      { delay_hours: 336, action: 'check_county', description: 'Bi-weekly county check' },
    ]
  },
  
  // Agreement sent, payment pending
  payment_pending: {
    name: 'Payment Pending',
    steps: [
      { delay_hours: 48, action: 'generate_payment_reminder', description: 'Payment reminder', condition: 'not_paid' },
      { delay_hours: 120, action: 'generate_payment_reminder', description: 'Second payment reminder', condition: 'not_paid' },
      { delay_hours: 240, action: 'alert_tyler', description: 'Escalate unpaid to Tyler', condition: 'not_paid' },
    ]
  }
};

/**
 * Determine which follow-up sequence a lead should be in
 */
function getFollowUpSequence(lead, timeline) {
  const status = lead.status || '';
  const mdr = lead.missing_data_reason || '';
  
  // Deadline passed — no follow-up
  if (timeline && timeline.status === 'DEADLINE_PASSED') {
    return { sequence: null, reason: 'Deadline passed' };
  }
  
  // Waiting on county — monitoring only
  if (mdr === 'WAITING_ON_COUNTY' || (timeline && timeline.status === 'WAITING_FOR_NOTICE')) {
    return { sequence: 'waiting_county', reason: 'County notices not released' };
  }
  
  // Blocked — needs data, not follow-up
  if (status === 'Blocked - Bad Data') {
    return { sequence: null, reason: 'Blocked — needs data enrichment first' };
  }
  
  // Pending approval — waiting for Tyler
  if (status === 'Pending Approval') {
    // Check if agreement sent but not signed
    if (lead.fee_agreement_signed && !(lead.initiation_paid || lead.initiation_fee_paid) && lead.agreement_type !== 'legacy_terms') {
      return { sequence: 'payment_pending', reason: 'Signed but $79 not paid' };
    }
    return { sequence: 'pending_approval', reason: 'Awaiting Tyler review' };
  }
  
  // No Case with good data — likely low savings
  if (status === 'No Case') {
    return { sequence: null, reason: 'No viable case' };
  }
  
  // Needs Analysis
  if (status === 'Needs Analysis') {
    return { sequence: 'new_lead', reason: 'Analysis not yet run' };
  }
  
  return { sequence: null, reason: 'No sequence applicable' };
}

/**
 * Calculate next follow-up date based on sequence and lead state
 */
function getNextFollowUp(lead, timeline) {
  const { sequence, reason } = getFollowUpSequence(lead, timeline);
  
  if (!sequence || !SEQUENCES[sequence]) {
    return { next_date: null, next_action: null, sequence: null, reason };
  }
  
  const seq = SEQUENCES[sequence];
  const lastContact = lead.last_contact_at || lead.updated_at || lead.created_at;
  const lastDate = new Date(lastContact);
  const now = new Date();
  
  // Find next applicable step
  for (const step of seq.steps) {
    const stepDate = new Date(lastDate.getTime() + step.delay_hours * 3600000);
    if (stepDate > now) {
      return {
        next_date: stepDate.toISOString(),
        next_action: step.description,
        action_type: step.action,
        sequence: sequence,
        sequence_name: seq.name,
        reason
      };
    }
  }
  
  // All steps exhausted
  return {
    next_date: null,
    next_action: 'Sequence complete',
    sequence,
    sequence_name: seq.name,
    reason
  };
}

/**
 * Full lead enrichment: priority + follow-up
 */
function enrichLead(lead) {
  const priority = calculatePriority(lead);
  const state = (lead.state || '').trim();
  const county = (lead.county || '').trim();
  const timeline = getCountyStatus(state, county);
  const followUp = getNextFollowUp(lead, timeline);
  
  return {
    priority,
    follow_up: followUp,
    timeline
  };
}

module.exports = { calculatePriority, getFollowUpSequence, getNextFollowUp, enrichLead, SEQUENCES };
