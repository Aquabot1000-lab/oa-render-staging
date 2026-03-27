const fs = require('fs');
const path = require('path');

// Load Colorado county data from JSON
const CO_COUNTIES_PATH = path.join(__dirname, '..', '..', 'data', 'colorado-county-filing-guide.json');
let CO_COUNTIES = [];
try {
    CO_COUNTIES = JSON.parse(fs.readFileSync(CO_COUNTIES_PATH, 'utf8'));
} catch (err) {
    console.warn('[CountyConfig] Could not load Colorado county data:', err.message);
}

// Texas Counties Configuration
const TX_COUNTIES = {
    bexar: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '2026-05-15', hearing_start: '2026-06-01', hearing_end: '2026-08-31' },
        portal_url: 'https://bcad.org/online-portal/',
        assessor_email: 'info@bcad.org',
        assessor_phone: '(210) 242-2432',
        required_forms: ['Form 50-132 (Notice of Protest)', 'Form 50-162 (Agent Authorization)'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'Log into BCAD eFile portal at https://bcad.org/online-portal/',
            'Upload signed Form 50-162 (Agent Authorization)',
            'File Form 50-132 (Notice of Protest) for Unequal Appraisal and Market Value',
            'Upload evidence packet (comps, photos, analysis)',
            'Submit protest and save confirmation number'
        ]
    },
    harris: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '2026-05-15', hearing_start: '2026-06-15', hearing_end: '2026-09-15' },
        portal_url: 'https://owners.hcad.org',
        assessor_email: 'protests@hcad.org',
        assessor_phone: '(713) 957-7800',
        required_forms: ['Form 50-132 (Notice of Protest)', 'Form 50-162 (Agent Authorization)'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'Create account or log into HCAD iFile portal',
            'Upload Form 50-162 (Agent Authorization)',
            'File protest selecting both Unequal Appraisal and Market Value',
            'Attach evidence packet',
            'Submit and save confirmation'
        ]
    },
    travis: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '2026-05-15', hearing_start: '2026-07-01', hearing_end: '2026-09-30' },
        portal_url: 'https://traviscad.org/efile/',
        assessor_email: 'protest@traviscad.org',
        assessor_phone: '(512) 834-9317',
        required_forms: ['Form 50-132 (Notice of Protest)', 'Form 50-162 (Agent Authorization)'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'Access TCAD eFile system',
            'Upload signed Form 50-162',
            'File Form 50-132 for both protest grounds',
            'Upload supporting evidence',
            'Submit and retain confirmation'
        ]
    },
    dallas: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '2026-05-15', hearing_start: '2026-06-01', hearing_end: '2026-08-31' },
        portal_url: 'https://www.dallascad.org',
        assessor_email: 'protest@dcad.org',
        assessor_phone: '(214) 631-0910',
        required_forms: ['Form 50-132 (Notice of Protest)', 'Form 50-162 (Agent Authorization)'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'Log into DCAD eFile portal',
            'Upload Form 50-162 (Agent Authorization)',
            'File Form 50-132 protest',
            'Attach evidence documentation',
            'Submit and save confirmation'
        ]
    },
    tarrant: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '2026-05-15', hearing_start: '2026-06-15', hearing_end: '2026-09-15' },
        portal_url: 'https://www.tad.org/login',
        assessor_email: 'protest@tad.org',
        assessor_phone: '(817) 284-0024',
        required_forms: ['Form 50-132 (Notice of Protest)', 'Form 50-162 (Agent Authorization)'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'Access Tarrant Appraisal District online portal',
            'Upload signed agent authorization',
            'File protest for unequal appraisal and market value',
            'Upload evidence packet',
            'Submit and document confirmation number'
        ]
    },
    collin: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '2026-05-15', hearing_start: '2026-06-01', hearing_end: '2026-08-31' },
        portal_url: 'https://www.collincad.org',
        assessor_email: 'protest@collincad.org',
        assessor_phone: '(469) 742-9200',
        required_forms: ['Form 50-132 (Notice of Protest)', 'Form 50-162 (Agent Authorization)'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'Log into Collin CAD portal',
            'Submit Form 50-162',
            'File Form 50-132 protest',
            'Attach evidence',
            'Submit and save confirmation'
        ]
    },
    denton: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '2026-05-15', hearing_start: '2026-06-15', hearing_end: '2026-09-15' },
        portal_url: 'https://www.dentoncad.com',
        assessor_email: 'protest@dentoncad.com',
        assessor_phone: '(940) 349-3800',
        required_forms: ['Form 50-132 (Notice of Protest)', 'Form 50-162 (Agent Authorization)'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'Access Denton CAD portal',
            'Upload agent authorization',
            'File protest',
            'Attach evidence',
            'Submit and save confirmation'
        ]
    },
    'fort-bend': {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '2026-05-15', hearing_start: '2026-06-01', hearing_end: '2026-08-31' },
        portal_url: 'https://www.fbcad.org',
        assessor_email: 'protest@fbcad.org',
        assessor_phone: '(281) 344-8623',
        required_forms: ['Form 50-132 (Notice of Protest)', 'Form 50-162 (Agent Authorization)'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'Log into Fort Bend CAD portal',
            'Submit Form 50-162',
            'File protest',
            'Upload evidence',
            'Submit and save confirmation'
        ]
    },
    williamson: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '2026-05-15', hearing_start: '2026-06-15', hearing_end: '2026-09-15' },
        portal_url: 'https://www.wcad.org',
        assessor_email: 'protest@wcad.org',
        assessor_phone: '(512) 930-3787',
        required_forms: ['Form 50-132 (Notice of Protest)', 'Form 50-162 (Agent Authorization)'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'Access Williamson CAD portal',
            'Upload agent authorization',
            'File protest',
            'Attach evidence',
            'Submit and save confirmation'
        ]
    },
    'el-paso': {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '2026-05-15', hearing_start: '2026-06-01', hearing_end: '2026-08-31' },
        portal_url: 'https://www.epcad.org',
        assessor_email: 'protest@epcad.org',
        assessor_phone: '(915) 780-2009',
        required_forms: ['Form 50-132 (Notice of Protest)', 'Form 50-162 (Agent Authorization)'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'Log into El Paso CAD portal',
            'Submit Form 50-162',
            'File protest',
            'Upload evidence',
            'Submit and save confirmation'
        ]
    },
    montgomery: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '2026-05-15', hearing_start: '2026-06-15', hearing_end: '2026-09-15' },
        portal_url: 'https://www.mcad-tx.org',
        assessor_email: 'protest@mcad-tx.org',
        assessor_phone: '(936) 756-3374',
        required_forms: ['Form 50-132 (Notice of Protest)', 'Form 50-162 (Agent Authorization)'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'Access Montgomery CAD portal',
            'Upload agent authorization',
            'File protest',
            'Attach evidence',
            'Submit and save confirmation'
        ]
    },
    hidalgo: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '2026-05-15', hearing_start: '2026-06-01', hearing_end: '2026-08-31' },
        portal_url: 'https://www.hidalgoad.org',
        assessor_email: 'protest@hidalgoad.org',
        assessor_phone: '(956) 318-2300',
        required_forms: ['Form 50-132 (Notice of Protest)', 'Form 50-162 (Agent Authorization)'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'Log into Hidalgo CAD portal',
            'Submit Form 50-162',
            'File protest',
            'Upload evidence',
            'Submit and save confirmation'
        ]
    },
    hays: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '2026-05-15', hearing_start: '2026-06-15', hearing_end: '2026-09-15' },
        portal_url: 'https://www.hayscad.com',
        assessor_email: 'protest@hayscad.com',
        assessor_phone: '(512) 268-2522',
        required_forms: ['Form 50-132 (Notice of Protest)', 'Form 50-162 (Agent Authorization)'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'Access Hays CAD portal',
            'Upload agent authorization',
            'File protest',
            'Attach evidence',
            'Submit and save confirmation'
        ]
    },
    comal: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '2026-05-15', hearing_start: '2026-06-01', hearing_end: '2026-08-31' },
        portal_url: 'https://www.comalad.org',
        assessor_email: 'protest@comalad.org',
        assessor_phone: '(830) 625-8597',
        required_forms: ['Form 50-132 (Notice of Protest)', 'Form 50-162 (Agent Authorization)'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'Log into Comal CAD portal',
            'Submit Form 50-162',
            'File protest',
            'Upload evidence',
            'Submit and save confirmation'
        ]
    },
    guadalupe: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '2026-05-15', hearing_start: '2026-06-15', hearing_end: '2026-09-15' },
        portal_url: 'https://www.guadalupecad.org',
        assessor_email: 'protest@guadalupecad.org',
        assessor_phone: '(830) 372-3887',
        required_forms: ['Form 50-132 (Notice of Protest)', 'Form 50-162 (Agent Authorization)'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'Access Guadalupe CAD portal',
            'Upload agent authorization',
            'File protest',
            'Attach evidence',
            'Submit and save confirmation'
        ]
    },
    hunt: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '2026-05-15', hearing_start: '2026-06-01', hearing_end: '2026-08-31' },
        portal_url: 'https://www.huntcad.com',
        assessor_email: 'protest@huntcad.com',
        assessor_phone: '(903) 454-3510',
        required_forms: ['Form 50-132 (Notice of Protest)', 'Form 50-162 (Agent Authorization)'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'Log into Hunt CAD portal',
            'Submit Form 50-162',
            'File protest',
            'Upload evidence',
            'Submit and save confirmation'
        ]
    },
    kaufman: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '2026-05-15', hearing_start: '2026-06-15', hearing_end: '2026-09-15' },
        portal_url: 'https://www.kaufmancad.org',
        assessor_email: 'protest@kaufmancad.org',
        assessor_phone: '(972) 932-6901',
        required_forms: ['Form 50-132 (Notice of Protest)', 'Form 50-162 (Agent Authorization)'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'Access Kaufman CAD portal',
            'Upload agent authorization',
            'File protest',
            'Attach evidence',
            'Submit and save confirmation'
        ]
    },
    medina: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '2026-05-15', hearing_start: '2026-06-01', hearing_end: '2026-08-31' },
        portal_url: 'https://www.medinacad.org',
        assessor_email: 'protest@medinacad.org',
        assessor_phone: '(830) 741-3035',
        required_forms: ['Form 50-132 (Notice of Protest)', 'Form 50-162 (Agent Authorization)'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'Log into Medina CAD portal',
            'Submit Form 50-162',
            'File protest',
            'Upload evidence',
            'Submit and save confirmation'
        ]
    }
};

// Georgia Counties Configuration
const GA_COUNTIES = {
    fulton: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '45 days after Notice of Value (NOV)', hearing_window: 'Within 90 days of filing' },
        portal_url: 'https://fultonassessor.org/property-appeals/',
        assessor_email: 'appeals@fultoncountyga.gov',
        assessor_phone: '(404) 612-6440',
        required_forms: ['Appeal Form', 'Power of Attorney (Letter of Authorization)'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'File appeal with Board of Assessors within 45 days of NOV',
            'Submit Power of Attorney (Letter of Authorization)',
            'Include evidence packet with comparable sales',
            'Board will review and schedule hearing if needed',
            'Await determination from Board of Assessors'
        ]
    },
    dekalb: {
        filing_method: 'email',
        deadline_dates: { protest_deadline: '45 days after Notice of Value', hearing_window: 'Within 90 days' },
        portal_url: 'https://www.dekalbcountyga.gov/tax-appeals',
        assessor_email: 'taxappeals@dekalbcountyga.gov',
        assessor_phone: '(404) 371-3011',
        required_forms: ['Appeal Form', 'Power of Attorney'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'File with Board of Assessors within 45 days',
            'Submit signed POA and appeal form',
            'Attach evidence packet',
            'Await hearing schedule',
            'Represent client at hearing'
        ]
    },
    cobb: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '45 days after NOV', hearing_window: 'Within 90 days' },
        portal_url: 'https://www.cobbassessor.org/appeals',
        assessor_email: 'appeals@cobbcounty.org',
        assessor_phone: '(770) 528-3100',
        required_forms: ['Appeal Form', 'Letter of Authorization'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'Submit appeal to Board of Assessors',
            'Upload Letter of Authorization',
            'Provide comparable sales evidence',
            'Attend hearing if scheduled',
            'Receive determination'
        ]
    },
    gwinnett: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '45 days after NOV', hearing_window: 'Within 90 days' },
        portal_url: 'https://www.gwinnettassessor.com/appeals',
        assessor_email: 'appeals@gwinnettcounty.com',
        assessor_phone: '(770) 822-7200',
        required_forms: ['Appeal Form', 'Power of Attorney'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'File appeal with Board of Assessors',
            'Submit POA',
            'Provide evidence packet',
            'Attend hearing',
            'Receive determination'
        ]
    },
    cherokee: {
        filing_method: 'email',
        deadline_dates: { protest_deadline: '45 days after NOV', hearing_window: 'Within 90 days' },
        portal_url: 'https://www.cherokeega-assessor.org',
        assessor_email: 'appeals@cherokeega.com',
        assessor_phone: '(770) 479-0478',
        required_forms: ['Appeal Form', 'Power of Attorney'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'File with Board of Assessors',
            'Submit POA and evidence',
            'Await hearing',
            'Represent client',
            'Receive determination'
        ]
    },
    forsyth: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '45 days after NOV', hearing_window: 'Within 90 days' },
        portal_url: 'https://www.forsythco.com/Assessors/Appeals',
        assessor_email: 'appeals@forsythco.com',
        assessor_phone: '(770) 781-2110',
        required_forms: ['Appeal Form', 'Letter of Authorization'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'Submit appeal online or by mail',
            'Include Letter of Authorization',
            'Attach evidence',
            'Attend hearing',
            'Receive determination'
        ]
    },
    hall: {
        filing_method: 'email',
        deadline_dates: { protest_deadline: '45 days after NOV', hearing_window: 'Within 90 days' },
        portal_url: 'https://www.hallcounty.org/235/Board-of-Assessors',
        assessor_email: 'appeals@hallcounty.org',
        assessor_phone: '(770) 531-6720',
        required_forms: ['Appeal Form', 'Power of Attorney'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'File appeal with Board',
            'Submit POA',
            'Provide evidence',
            'Attend hearing',
            'Receive determination'
        ]
    },
    henry: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: '45 days after NOV', hearing_window: 'Within 90 days' },
        portal_url: 'https://www.co.henry.ga.us/Departments/H-L/Human-Resources/Board-of-Assessors',
        assessor_email: 'appeals@co.henry.ga.us',
        assessor_phone: '(770) 288-8170',
        required_forms: ['Appeal Form', 'Power of Attorney'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'File with Board of Assessors',
            'Submit POA',
            'Attach evidence',
            'Attend hearing',
            'Receive determination'
        ]
    }
};

// Washington Counties Configuration
const WA_COUNTIES = {
    king: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: 'July 1 (or 60 days after value notice)', hearing_window: 'July-November' },
        portal_url: 'https://www.kingcounty.gov/depts/assessor/appeals.aspx',
        assessor_email: 'appeals@kingcounty.gov',
        assessor_phone: '(206) 296-7300',
        required_forms: ['Petition for Review', 'Agent Authorization'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'File Petition for Review with County Board of Equalization',
            'Submit agent authorization',
            'Provide comparable sales evidence',
            'Attend board hearing',
            'Receive determination'
        ]
    },
    pierce: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: 'July 1 (or 60 days after notice)', hearing_window: 'July-November' },
        portal_url: 'https://www.piercecountywa.gov/267/Board-of-Equalization',
        assessor_email: 'boe@piercecountywa.gov',
        assessor_phone: '(253) 798-3313',
        required_forms: ['Petition for Review', 'Agent Authorization'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'File with Board of Equalization by July 1',
            'Submit agent authorization',
            'Provide evidence',
            'Attend hearing',
            'Receive determination'
        ]
    },
    snohomish: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: 'July 1', hearing_window: 'July-November' },
        portal_url: 'https://snohomishcountywa.gov/180/Board-of-Equalization',
        assessor_email: 'boe@snoco.org',
        assessor_phone: '(425) 388-3433',
        required_forms: ['Petition for Review', 'Agent Authorization'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'File petition with Board of Equalization',
            'Submit agent authorization',
            'Provide evidence',
            'Attend hearing',
            'Receive determination'
        ]
    },
    kitsap: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: 'July 1', hearing_window: 'July-October' },
        portal_url: 'https://www.kitsapgov.com/assessor/Pages/Board-of-Equalization.aspx',
        assessor_email: 'boe@kitsap.gov',
        assessor_phone: '(360) 337-7160',
        required_forms: ['Petition for Review', 'Agent Authorization'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'File petition by July 1',
            'Submit agent authorization',
            'Provide evidence',
            'Attend hearing',
            'Receive determination'
        ]
    },
    clark: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: 'July 1', hearing_window: 'July-October' },
        portal_url: 'https://www.clark.wa.gov/assessor/board-equalization',
        assessor_email: 'boe@clark.wa.gov',
        assessor_phone: '(564) 397-2391',
        required_forms: ['Petition for Review', 'Agent Authorization'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'File petition with Board of Equalization',
            'Submit agent authorization',
            'Provide evidence',
            'Attend hearing',
            'Receive determination'
        ]
    }
};

// Ohio Counties Configuration
const OH_COUNTIES = {
    franklin: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: 'March 31', hearing_window: 'April-August' },
        portal_url: 'https://franklincountyauditor.com/real-estate/board-of-revision',
        assessor_email: 'bor@franklincountyohio.gov',
        assessor_phone: '(614) 525-3240',
        required_forms: ['DTE Form 1 (Complaint)', 'Agent Authorization'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'File DTE Form 1 with Board of Revision by March 31',
            'Submit agent authorization',
            'Provide evidence packet with comparable sales',
            'Attend hearing before Board of Revision',
            'Receive determination'
        ]
    },
    cuyahoga: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: 'March 31', hearing_window: 'April-September' },
        portal_url: 'https://bor.cuyahogacounty.us/',
        assessor_email: 'bor@cuyahogacounty.us',
        assessor_phone: '(216) 443-7010',
        required_forms: ['DTE Form 1', 'Agent Authorization'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'File DTE Form 1 online by March 31',
            'Submit agent authorization',
            'Provide evidence',
            'Attend Board of Revision hearing',
            'Receive determination'
        ]
    },
    hamilton: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: 'March 31', hearing_window: 'April-August' },
        portal_url: 'https://www.hamilton-co.org/government/departments/board_of_revision',
        assessor_email: 'bor@hamilton-co.org',
        assessor_phone: '(513) 946-4000',
        required_forms: ['DTE Form 1', 'Agent Authorization'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'File DTE Form 1 by March 31',
            'Submit agent authorization',
            'Provide evidence',
            'Attend hearing',
            'Receive determination'
        ]
    },
    summit: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: 'March 31', hearing_window: 'April-August' },
        portal_url: 'https://fiscaloffice.summitoh.net/index.php/board-of-revision',
        assessor_email: 'bor@summitoh.net',
        assessor_phone: '(330) 643-2600',
        required_forms: ['DTE Form 1', 'Agent Authorization'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'File DTE Form 1 by March 31',
            'Submit agent authorization',
            'Provide evidence',
            'Attend hearing',
            'Receive determination'
        ]
    },
    montgomery: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: 'March 31', hearing_window: 'April-August' },
        portal_url: 'https://www.mcohio.org/government/elected_officials/board_of_revision/index.php',
        assessor_email: 'bor@mcohio.org',
        assessor_phone: '(937) 225-4040',
        required_forms: ['DTE Form 1', 'Agent Authorization'],
        agent_auth_type: 'standard',
        filing_instructions: [
            'File DTE Form 1 by March 31',
            'Submit agent authorization',
            'Provide evidence',
            'Attend hearing',
            'Receive determination'
        ]
    }
};

// Arizona Counties Configuration
const AZ_COUNTIES = {
    maricopa: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: 'April 21 (or 60 days after notice)', hearing_window: 'May-July' },
        portal_url: 'https://www.maricopa.gov/1328/Appeal-Your-Value',
        assessor_email: 'appeals@maricopa.gov',
        assessor_phone: '(602) 506-3406',
        required_forms: ['Appeal Form', 'Agency Authorization'],
        agent_auth_type: 'notarized',
        filing_instructions: [
            'File appeal with County Assessor by April 21',
            'Submit notarized Agency Authorization',
            'Provide comparable sales evidence',
            'Await assessor review',
            'If unsatisfied, appeal to State Board of Equalization'
        ]
    },
    pima: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: 'April 21', hearing_window: 'May-July' },
        portal_url: 'https://www.asr.pima.gov/property-valuation-appeals',
        assessor_email: 'appeals@pima.gov',
        assessor_phone: '(520) 724-8630',
        required_forms: ['Appeal Form', 'Agency Authorization'],
        agent_auth_type: 'notarized',
        filing_instructions: [
            'File appeal by April 21',
            'Submit notarized authorization',
            'Provide evidence',
            'Await assessor review',
            'Appeal to State BOE if needed'
        ]
    },
    pinal: {
        filing_method: 'online',
        deadline_dates: { protest_deadline: 'April 21', hearing_window: 'May-July' },
        portal_url: 'https://www.pinalcountyaz.gov/Assessor/Pages/Appeals.aspx',
        assessor_email: 'appeals@pinal.gov',
        assessor_phone: '(520) 509-3555',
        required_forms: ['Appeal Form', 'Agency Authorization'],
        agent_auth_type: 'notarized',
        filing_instructions: [
            'File appeal by April 21',
            'Submit notarized authorization',
            'Provide evidence',
            'Await assessor review',
            'Appeal to State BOE if needed'
        ]
    },
    coconino: {
        filing_method: 'email',
        deadline_dates: { protest_deadline: 'April 21', hearing_window: 'May-July' },
        portal_url: 'https://www.coconino.az.gov/162/Assessor',
        assessor_email: 'appeals@coconino.az.gov',
        assessor_phone: '(928) 679-7960',
        required_forms: ['Appeal Form', 'Agency Authorization'],
        agent_auth_type: 'notarized',
        filing_instructions: [
            'File appeal by April 21',
            'Submit notarized authorization',
            'Provide evidence',
            'Await assessor review',
            'Appeal to State BOE if needed'
        ]
    },
    yavapai: {
        filing_method: 'email',
        deadline_dates: { protest_deadline: 'April 21', hearing_window: 'May-July' },
        portal_url: 'https://www.yavapaiaz.gov/Departments/Assessor',
        assessor_email: 'appeals@yavapaiaz.gov',
        assessor_phone: '(928) 771-3220',
        required_forms: ['Appeal Form', 'Agency Authorization'],
        agent_auth_type: 'notarized',
        filing_instructions: [
            'File appeal by April 21',
            'Submit notarized authorization',
            'Provide evidence',
            'Await assessor review',
            'Appeal to State BOE if needed'
        ]
    }
};

// Convert Colorado data to standard format
function buildCOCountyConfig(coCounty) {
    const countyName = coCounty.county.toLowerCase();
    const filingMethods = coCounty.filing_methods || [];
    const preferredMethod = coCounty.online_portal ? 'online' : (filingMethods.includes('email') ? 'email' : 'mail');

    return {
        filing_method: preferredMethod,
        deadline_dates: {
            nov_mailing: coCounty.dates_2026?.nov_mailing || '2026-05-01',
            protest_deadline: coCounty.dates_2026?.protest_deadline || '2026-06-08',
            assessor_determination: coCounty.dates_2026?.assessor_determination || '2026-06-30',
            cboe_appeal_deadline: coCounty.dates_2026?.cboe_appeal_deadline || '2026-07-15',
            cboe_hearing_deadline: coCounty.dates_2026?.cboe_hearing_deadline || '2026-08-05'
        },
        portal_url: coCounty.assessor_url || null,
        assessor_email: coCounty.assessor_email || null,
        assessor_phone: coCounty.assessor_phone || null,
        required_forms: ['Notice of Protest', 'Agent Authorization Form'],
        agent_auth_type: coCounty.notarization_required ? 'notarized' : 'standard',
        filing_instructions: [
            'File Notice of Protest with County Assessor by June 8, 2026',
            'Submit Agent Authorization Form' + (coCounty.notarization_required ? ' (notarized)' : ''),
            'Provide comparable sales evidence',
            'Await assessor determination by June 30',
            'If unsatisfied, appeal to County Board of Equalization by July 15'
        ],
        notes: coCounty.notes || null
    };
}

const CO_COUNTIES_CONFIG = {};
CO_COUNTIES.forEach(county => {
    const key = county.county.toLowerCase().replace(/\s+/g, '-');
    CO_COUNTIES_CONFIG[key] = buildCOCountyConfig(county);
});

// Master county configuration
const COUNTY_CONFIG = {
    TX: TX_COUNTIES,
    GA: GA_COUNTIES,
    WA: WA_COUNTIES,
    OH: OH_COUNTIES,
    AZ: AZ_COUNTIES,
    CO: CO_COUNTIES_CONFIG
};

/**
 * Get full county configuration
 * @param {string} state - Two-letter state code (TX, GA, WA, OH, AZ, CO)
 * @param {string} county - County name (lowercase, hyphenated)
 * @returns {object|null} County configuration or null if not found
 */
function getCountyConfig(state, county) {
    const stateUpper = (state || '').toUpperCase();
    const countyLower = (county || '').toLowerCase();

    if (!COUNTY_CONFIG[stateUpper]) {
        return null;
    }

    return COUNTY_CONFIG[stateUpper][countyLower] || null;
}

/**
 * Get filing deadline for a county
 * @param {string} state
 * @param {string} county
 * @returns {string|null} Filing deadline date or description
 */
function getFilingDeadline(state, county) {
    const config = getCountyConfig(state, county);
    if (!config) return null;

    const deadlines = config.deadline_dates;
    return deadlines.protest_deadline || deadlines.filing_deadline || null;
}

/**
 * Get filing method for a county
 * @param {string} state
 * @param {string} county
 * @returns {string|null} Filing method (online, email, mail, in-person)
 */
function getFilingMethod(state, county) {
    const config = getCountyConfig(state, county);
    return config ? config.filing_method : null;
}

/**
 * Check if county requires notarized agent authorization
 * @param {string} state
 * @param {string} county
 * @returns {boolean} True if notarization required
 */
function requiresNotary(state, county) {
    const config = getCountyConfig(state, county);
    return config ? config.agent_auth_type === 'notarized' : false;
}

/**
 * List all supported counties for a state
 * @param {string} state - Two-letter state code
 * @returns {string[]} Array of county names
 */
function listCounties(state) {
    const stateUpper = (state || '').toUpperCase();
    if (!COUNTY_CONFIG[stateUpper]) {
        return [];
    }
    return Object.keys(COUNTY_CONFIG[stateUpper]);
}

module.exports = {
    getCountyConfig,
    getFilingDeadline,
    getFilingMethod,
    requiresNotary,
    listCounties
};
