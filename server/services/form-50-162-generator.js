/**
 * form-50-162-generator.js
 * Pre-fills Form 50-162 (Texas Comptroller Appointment of Agent) using pdf-lib.
 *
 * Pure-Node port of the Python `form-50-162-generator.py` so production
 * (Render Node-only image) does not need pypdf.
 *
 * Usage:
 *   const { generatePrefilledForm } = require('./form-50-162-generator');
 *   const outPath = await generatePrefilledForm(caseData, agentInfo);
 *
 * Per Tyler's red-ink approval:
 *  - Step 2: ☑ "the property(ies) listed below"
 *  - Step 4: ☑ "all property tax matters concerning the property identified"
 *  - Step 4: confidential-info radio = Yes
 *  - Step 4: ☑ all three communications boxes
 *  - Step 5: end date = "Until Otherwise Notified"
 *  - Step 6: printed Name + Title filled, ☑ "the property owner",
 *           Date + Signature1 left BLANK for customer
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'templates', 'form-50-162-agent-appointment.pdf');
const OUTPUT_DIR    = path.join(__dirname, '..', '..', 'generated-forms');

const COUNTY_TO_AD = {
  bexar: 'Bexar Appraisal District',
  tarrant: 'Tarrant Appraisal District',
  denton: 'Denton Central Appraisal District',
  harris: 'Harris County Appraisal District',
  travis: 'Travis Central Appraisal District',
  williamson: 'Williamson Central Appraisal District',
  collin: 'Collin Central Appraisal District',
  dallas: 'Dallas Central Appraisal District',
  kaufman: 'Kaufman County Appraisal District',
  'fort bend': 'Fort Bend Central Appraisal District',
  'el paso': 'El Paso Central Appraisal District',
  comal: 'Comal Appraisal District',
  hunt: 'Hunt County Appraisal District',
  johnson: 'Johnson County Appraisal District',
  mclennan: 'McLennan County Appraisal District',
  medina: 'Medina County Appraisal District',
  montgomery: 'Montgomery Central Appraisal District',
  galveston: 'Galveston Central Appraisal District',
  bowie: 'Bowie County Appraisal District',
  nueces: 'Nueces County Appraisal District',
};

function safeText(form, name, value) {
  if (value == null || value === '') return false;
  try {
    const f = form.getTextField(name);
    f.setText(String(value));
    try { f.enableReadOnly(); } catch (_) { /* not all libs expose this */ }
    return true;
  } catch (e) {
    console.warn(`[form-50-162][js] missing/unsettable text field "${name}": ${e.message}`);
    return false;
  }
}

function safeCheck(form, name) {
  try {
    form.getCheckBox(name).check();
    return true;
  } catch (e) {
    console.warn(`[form-50-162][js] missing/unsettable checkbox "${name}": ${e.message}`);
    return false;
  }
}

function safeRadio(form, name, optionLabel) {
  try {
    const r = form.getRadioGroup(name);
    const opts = r.getOptions();
    // Prefer exact match, otherwise the only "Yes"-style option
    const target =
      opts.find(o => o === optionLabel) ||
      opts.find(o => /^yes$/i.test(o)) ||
      opts[0];
    r.select(target);
    return true;
  } catch (e) {
    console.warn(`[form-50-162][js] missing/unsettable radio "${name}": ${e.message}`);
    return false;
  }
}

function parseAddressParts(address) {
  if (!address) return { street: '', cityStateZip: '' };
  const parts = String(address).split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 3) return { street: parts[0], cityStateZip: parts.slice(1).join(', ') };
  if (parts.length === 2) return { street: parts[0], cityStateZip: parts[1] };
  return { street: address, cityStateZip: '' };
}

/**
 * Generate a pre-filled (UNSIGNED) Form 50-162 PDF.
 *
 * @param {object} caseData
 *   .case_id, .owner_name, .phone, .property_address, .owner_address,
 *   .owner_city_state_zip, .county, .account_number, .legal_description
 * @param {object} agentInfo
 *   .name, .phone, .address, .city_state_zip
 * @param {string} [outputPath] - optional explicit output path
 * @returns {Promise<string>} absolute path to the generated PDF
 */
async function generatePrefilledForm(caseData, agentInfo, outputPath) {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`Form 50-162 template missing: ${TEMPLATE_PATH}`);
  }
  const bytes = fs.readFileSync(TEMPLATE_PATH);
  const doc   = await PDFDocument.load(bytes);
  const form  = doc.getForm();

  const county = (caseData.county || '').toLowerCase();
  const adName = COUNTY_TO_AD[county] || `${caseData.county || ''} Appraisal District`;

  // --- STEP 1: Owner info --------------------------------------------------
  safeText(form, 'Appraisal District Name',                adName);
  safeText(form, 'Name',                                    caseData.owner_name);
  safeText(form, 'Telephone Number include area code',      caseData.phone);

  const { street: ownerStreet, cityStateZip: ownerCsz } = parseAddressParts(caseData.owner_address || caseData.property_address);
  safeText(form, 'Address',              caseData.owner_address || ownerStreet);
  safeText(form, 'City State Zip Code',  caseData.owner_city_state_zip || ownerCsz);

  // --- STEP 2: Property identification -------------------------------------
  safeCheck(form, 'the property(ies) listed below:');

  let fullAddr = caseData.property_address || '';
  if (caseData.owner_city_state_zip && !fullAddr.includes(caseData.owner_city_state_zip)) {
    fullAddr = fullAddr ? `${fullAddr}, ${caseData.owner_city_state_zip}` : caseData.owner_city_state_zip;
  }
  safeText(form, 'Appraisal District Account Number_2',   caseData.account_number);
  safeText(form, 'Physical or Situs Address of Property_2', fullAddr);
  safeText(form, 'Legal Description_2',                   caseData.legal_description);

  // --- STEP 3: Agent info --------------------------------------------------
  safeText(form, 'Name_2',                                  agentInfo.name);
  safeText(form, 'Telephone Number include area code_2',    agentInfo.phone);
  safeText(form, 'Address_2',                               agentInfo.address);
  safeText(form, 'City State Zip Code_2',                   agentInfo.city_state_zip);

  // --- STEP 4: Agent's Authority ------------------------------------------
  safeCheck(form, 'all property tax matters concerning the property identified');
  safeRadio(form,
    'The agent identified above is authorized to receive confidential information pursuant to Tax Code §§11.48(b)(2), 22.27(b)(2), 23.123(c)(2), 23.126(c)(2), and 23.45(b)(2):',
    'Yes'
  );
  safeCheck(form, 'all communications from the chief appraiser');
  safeCheck(form, 'all communications from the appraisal review board');
  safeCheck(form, 'all communications from all taxing units participating in the appraisal district');

  // --- STEP 5: End date ----------------------------------------------------
  safeText(form, 'Date Agents Authority Ends', 'Until Otherwise Notified');

  // --- STEP 6: Printed name, Title, "the property owner" — leave Date+Signature blank
  safeText(form, 'Name of Property Owner', caseData.owner_name);
  safeText(form, 'Title',                  'Property Owner');
  safeCheck(form, 'the property owner');

  // Persist (do NOT flatten — sign-form-50-162.js draws the signature image after)
  const out = outputPath || (() => {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const safe = String(caseData.case_id || 'unknown').replace(/\//g, '-');
    return path.join(OUTPUT_DIR, `Form-50-162_${safe}.pdf`);
  })();

  const outBytes = await doc.save({ updateFieldAppearances: true });
  fs.writeFileSync(out, outBytes);
  return out;
}

module.exports = { generatePrefilledForm, COUNTY_TO_AD };
