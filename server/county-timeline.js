/**
 * County Timeline Engine
 * Auto-calculates filing status based on state/county deadlines
 * 
 * Statuses:
 *   WAITING_FOR_NOTICE  - County hasn't released values yet
 *   NOTICE_EXPECTED     - Notice window approaching, light monitoring
 *   NOTICE_SENT         - Values released, ready to analyze/file
 *   DEADLINE_APPROACHING - <14 days to protest deadline
 *   DEADLINE_PASSED      - Too late to file for this year
 */

// All dates are for tax year 2026
const COUNTY_TIMELINES = {
  // ═══════════════ TEXAS ═══════════════
  // TX: Appraisal districts mail notices April 1–May 1
  // Protest deadline: May 15 (or 30 days after notice, whichever is later)
  TX: {
    default: {
      notice_start: '2026-04-01',
      notice_end: '2026-05-01',
      protest_deadline: '2026-05-15',
      filing_method: 'online_portal',
      notes: 'TX protest deadline May 15 or 30 days after notice'
    },
    counties: {
      'Bexar':       { notice_sent: true, notice_date: '2026-03-28', portal: 'https://bexar.trueprodigy.com' },
      'Dallas':      { notice_sent: true, notice_date: '2026-04-01', portal: 'https://dallas.trueprodigy.com' },
      'Tarrant':     { notice_sent: true, notice_date: '2026-04-01', portal: 'https://tarrant.trueprodigy.com' },
      'Harris':      { notice_sent: true, notice_date: '2026-04-01', portal: 'https://harris.trueprodigy.com' },
      'Travis':      { notice_sent: true, notice_date: '2026-03-31', portal: 'https://travis.trueprodigy.com' },
      'Collin':      { notice_sent: true, notice_date: '2026-04-02', portal: 'https://collin.trueprodigy.com' },
      'Williamson':  { notice_sent: true, notice_date: '2026-04-01' },
      'Fort Bend':   { notice_sent: true, notice_date: '2026-04-01' },
      'Denton':      { notice_sent: true, notice_date: '2026-04-01' },
      'Montgomery':  { notice_sent: true, notice_date: '2026-04-01' },
      'Hays':        { notice_sent: true, notice_date: '2026-04-01' },
      'Comal':       { notice_sent: true, notice_date: '2026-04-01' },
      'Guadalupe':   { notice_sent: true, notice_date: '2026-04-01' },
      'El Paso':     { notice_sent: true, notice_date: '2026-04-01' },
      'Hidalgo':     { notice_sent: true, notice_date: '2026-04-02' },
      'Hunt':        { notice_sent: true, notice_date: '2026-04-01' },
    }
  },

  // ═══════════════ WASHINGTON ═══════════════
  // WA: Assessor sets values by Jan 1, notices mailed ~Feb-Mar
  // Appeal to Board of Equalization: 30-60 days after notice (varies by county)
  // Most deadlines: Jul 1
  WA: {
    default: {
      notice_start: '2026-02-01',
      notice_end: '2026-03-31',
      protest_deadline: '2026-07-01',
      filing_method: 'mail_or_online',
      notes: 'WA appeal to Board of Equalization, deadline varies by county (~Jul 1)'
    },
    counties: {
      'King':       { notice_sent: false, expected_notice: '2026-03-15', protest_deadline: '2026-07-01', portal: 'https://kingcounty.gov/assessor' },
      'Snohomish':  { notice_sent: false, expected_notice: '2026-03-01', protest_deadline: '2026-07-01' },
      'Pierce':     { notice_sent: false, expected_notice: '2026-03-01', protest_deadline: '2026-07-01' },
      'Clark':      { notice_sent: false, expected_notice: '2026-03-01', protest_deadline: '2026-07-01' },
      'Stevens':    { notice_sent: false, expected_notice: '2026-03-15', protest_deadline: '2026-07-01' },
    }
  },

  // ═══════════════ GEORGIA ═══════════════
  // GA: Assessor mails notices April-June (varies widely)
  // Appeal: 45 days from notice date
  GA: {
    default: {
      notice_start: '2026-04-01',
      notice_end: '2026-06-30',
      protest_deadline: '2026-08-15',
      filing_method: 'mail_or_in_person',
      notes: 'GA 45 days from notice to appeal, file PT-311A form'
    },
    counties: {
      'Fulton':  { notice_sent: false, expected_notice: '2026-05-01', protest_deadline: '2026-06-15' },
      'DeKalb':  { notice_sent: false, expected_notice: '2026-05-01', protest_deadline: '2026-06-15' },
    }
  },

  // ═══════════════ COLORADO ═══════════════
  // CO: Reassessment year (odd years), notices mailed May 1
  // Appeal deadline: June 1
  CO: {
    default: {
      notice_start: '2026-05-01',
      notice_end: '2026-05-15',
      protest_deadline: '2026-06-01',
      filing_method: 'online_or_mail',
      notes: 'CO reassessment year, notices May 1, deadline June 1'
    },
    counties: {
      'Denver':  { notice_sent: false, expected_notice: '2026-05-01', protest_deadline: '2026-06-01' },
      'Eagle':   { notice_sent: false, expected_notice: '2026-05-01', protest_deadline: '2026-06-01' },
      'Routt':   { notice_sent: false, expected_notice: '2026-05-01', protest_deadline: '2026-06-01' },
      'Pitkin':  { notice_sent: false, expected_notice: '2026-05-01', protest_deadline: '2026-06-01' },
    }
  },

  // ═══════════════ ARIZONA ═══════════════
  // AZ: Notices mailed Feb, appeal within 60 days
  AZ: {
    default: {
      notice_start: '2026-02-01',
      notice_end: '2026-02-28',
      protest_deadline: '2026-04-17',
      filing_method: 'online_or_mail',
      notes: 'AZ notices Feb, 60-day appeal window'
    },
    counties: {
      'Maricopa': { notice_sent: true, notice_date: '2026-02-15', protest_deadline: '2026-04-17', portal: 'https://mcassessor.maricopa.gov' },
      'Pima':     { notice_sent: true, notice_date: '2026-02-15', protest_deadline: '2026-04-17' },
      'Pinal':    { notice_sent: true, notice_date: '2026-02-15', protest_deadline: '2026-04-17' },
      'Coconino': { notice_sent: true, notice_date: '2026-02-15', protest_deadline: '2026-04-17' },
      'Yavapai':  { notice_sent: true, notice_date: '2026-02-15', protest_deadline: '2026-04-17' },
    }
  },

  // ═══════════════ OHIO ═══════════════
  OH: {
    default: {
      notice_start: '2026-01-01',
      notice_end: '2026-03-31',
      protest_deadline: '2026-03-31',
      filing_method: 'mail_or_online',
      notes: 'OH Board of Revision, deadline March 31'
    },
    counties: {}
  }
};

/**
 * Calculate county timeline status for a lead
 * @param {string} state - Two-letter state code
 * @param {string} county - County name
 * @param {Date} [asOf] - Date to evaluate (default: now)
 * @returns {object} Timeline status
 */
function getCountyStatus(state, county, asOf) {
  const now = asOf || new Date();
  const todayStr = now.toISOString().split('T')[0];
  
  const stateConfig = COUNTY_TIMELINES[state];
  if (!stateConfig) {
    return {
      status: 'UNKNOWN',
      state,
      county,
      message: `State ${state} not configured in timeline engine`,
      days_to_deadline: null,
      deadline: null,
      action: 'MANUAL_REVIEW'
    };
  }
  
  const defaults = stateConfig.default;
  const countyConfig = stateConfig.counties[county] || {};
  
  // Merge county overrides with state defaults
  const noticeSent = countyConfig.notice_sent ?? (todayStr >= defaults.notice_end);
  const noticeDate = countyConfig.notice_date || countyConfig.expected_notice || defaults.notice_start;
  const deadline = countyConfig.protest_deadline || defaults.protest_deadline;
  const portal = countyConfig.portal || null;
  
  const deadlineDate = new Date(deadline + 'T23:59:59');
  const daysToDeadline = Math.ceil((deadlineDate - now) / (1000 * 60 * 60 * 24));
  
  const noticeStartDate = new Date(defaults.notice_start);
  const noticeEndDate = new Date(defaults.notice_end);
  
  let status, message, action;
  
  if (daysToDeadline < 0) {
    status = 'DEADLINE_PASSED';
    message = `Protest deadline was ${deadline} (${Math.abs(daysToDeadline)} days ago)`;
    action = 'NO_ACTION';
  } else if (daysToDeadline <= 14) {
    status = 'DEADLINE_APPROACHING';
    message = `⚠️ ${daysToDeadline} days until deadline (${deadline})`;
    action = 'PRIORITIZE';
  } else if (noticeSent) {
    status = 'NOTICE_SENT';
    message = `Notices released${countyConfig.notice_date ? ' on ' + countyConfig.notice_date : ''}. Deadline: ${deadline} (${daysToDeadline} days)`;
    action = 'ANALYZE_AND_FILE';
  } else if (now >= noticeStartDate) {
    status = 'NOTICE_EXPECTED';
    message = `Notice window open (${defaults.notice_start} – ${defaults.notice_end}). Expected: ${noticeDate}`;
    action = 'MONITOR';
  } else {
    status = 'WAITING_FOR_NOTICE';
    message = `Notices not yet released. Window: ${defaults.notice_start} – ${defaults.notice_end}`;
    action = 'WAIT';
  }
  
  return {
    status,
    state,
    county: county || 'Unknown',
    message,
    action,
    notice_sent: noticeSent,
    notice_date: noticeSent ? (countyConfig.notice_date || 'Released') : null,
    expected_notice: !noticeSent ? (countyConfig.expected_notice || defaults.notice_start) : null,
    deadline,
    days_to_deadline: daysToDeadline,
    filing_method: defaults.filing_method,
    portal,
    notes: defaults.notes
  };
}

/**
 * Classify a lead and determine what action to take
 * @param {object} lead - Supabase submission record
 * @returns {object} Classification with recommended action
 */
function classifyLead(lead) {
  const state = (lead.state || '').trim();
  const county = (lead.county || '').trim();
  const timeline = getCountyStatus(state, county);
  
  // Customer notice status (separate from county-level)
  const customerNotice = (lead.customer_notice_status && lead.customer_notice_status !== 'null') ? lead.customer_notice_status : 'UNKNOWN';
  timeline.customer_notice_status = customerNotice;
  timeline.customer_notice_confirmed_at = lead.customer_notice_confirmed_at || null;
  
  let recommended_action = 'WAIT';
  let priority = 'NORMAL';
  let auto_trigger = null;
  
  switch (timeline.status) {
    case 'NOTICE_SENT':
      if (lead.status === 'No Case' || lead.status === 'Needs Analysis') {
        recommended_action = 'TRIGGER_ANALYSIS';
        auto_trigger = 'analyze_lead';
        priority = 'HIGH';
      } else if (lead.status === 'Pending Approval') {
        recommended_action = 'REVIEW_AND_FILE';
        priority = 'HIGH';
      } else if (lead.status === 'Blocked - Bad Data') {
        recommended_action = 'ENRICH_DATA';
        auto_trigger = 'enrich_lead';
        priority = 'MEDIUM';
      }
      break;
      
    case 'DEADLINE_APPROACHING':
      priority = 'URGENT';
      if (lead.status === 'Pending Approval') {
        recommended_action = 'FILE_IMMEDIATELY';
      } else if (lead.status === 'No Case' || lead.status === 'Needs Analysis') {
        recommended_action = 'RUSH_ANALYSIS';
        auto_trigger = 'analyze_lead';
      } else {
        recommended_action = 'ALERT_TYLER';
      }
      break;
      
    case 'DEADLINE_PASSED':
      recommended_action = 'CLOSE_FOR_YEAR';
      priority = 'LOW';
      break;
      
    case 'NOTICE_EXPECTED':
      recommended_action = 'MONITOR';
      priority = 'LOW';
      break;
      
    case 'WAITING_FOR_NOTICE':
      recommended_action = 'WAIT';
      priority = 'LOW';
      break;
      
    default:
      recommended_action = 'MANUAL_REVIEW';
      priority = 'MEDIUM';
  }
  
  return {
    timeline,
    recommended_action,
    priority,
    auto_trigger,
    case_id: lead.case_id,
    lead_id: lead.id
  };
}

module.exports = { getCountyStatus, classifyLead, COUNTY_TIMELINES };
