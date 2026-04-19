#!/usr/bin/env python3
"""
Form 50-162 Generator — Pre-fills Appointment of Agent for Property Tax Matters
Uses the official TX Comptroller fillable PDF template.

Per Tyler's instructions (red ink example):
- Step 2: Check "the property(ies) listed below"
- Step 4: Check "all property tax matters concerning the property identified"
- Step 4: Confidential info = Yes
- Step 4: Check "all communications from the chief appraiser"
- Step 4: Check "all communications from the appraisal review board"
- Step 5: End date = 12/31/2026
- Step 6: Leave signature + date BLANK for customer

Agent info filled in Step 3.
"""

import sys, os, json, copy
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, TextStringObject, BooleanObject, ArrayObject, NumberObject

# Use paths relative to this script's location (works on any server)
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_PATH = os.path.join(_SCRIPT_DIR, '..', '..', 'templates', 'form-50-162-agent-appointment.pdf')
OUTPUT_DIR = os.path.join(_SCRIPT_DIR, '..', '..', 'generated-forms')

# County -> Appraisal District Name mapping
COUNTY_TO_AD = {
    'bexar': 'Bexar Appraisal District',
    'tarrant': 'Tarrant Appraisal District',
    'denton': 'Denton Central Appraisal District',
    'harris': 'Harris County Appraisal District',
    'travis': 'Travis Central Appraisal District',
    'williamson': 'Williamson Central Appraisal District',
    'collin': 'Collin Central Appraisal District',
    'dallas': 'Dallas Central Appraisal District',
    'kaufman': 'Kaufman County Appraisal District',
    'fort bend': 'Fort Bend Central Appraisal District',
    'el paso': 'El Paso Central Appraisal District',
    'comal': 'Comal Appraisal District',
    'hunt': 'Hunt County Appraisal District',
    'johnson': 'Johnson County Appraisal District',
    'mclennan': 'McLennan County Appraisal District',
    'medina': 'Medina County Appraisal District',
    'montgomery': 'Montgomery Central Appraisal District',
    'galveston': 'Galveston Central Appraisal District',
    'bowie': 'Bowie County Appraisal District',
}


def set_field(writer, field_name, value):
    """Set a text field value in the PDF"""
    for page in writer.pages:
        if '/Annots' in page:
            for annot in page['/Annots']:
                obj = annot.get_object()
                if obj.get('/T') and str(obj['/T']) == field_name:
                    obj.update({
                        NameObject('/V'): TextStringObject(value),
                        NameObject('/Ff'): NumberObject(1)  # read-only
                    })
                    return True
    return False


def check_box(writer, field_name):
    """Check a checkbox field"""
    for page in writer.pages:
        if '/Annots' in page:
            for annot in page['/Annots']:
                obj = annot.get_object()
                if obj.get('/T') and str(obj['/T']) == field_name:
                    # Try standard checkbox values
                    ap = obj.get('/AP', {})
                    n = ap.get('/N', {}) if isinstance(ap, dict) else {}
                    
                    # Common checkbox on-values
                    for on_val in ['/Yes', '/On', '/1']:
                        obj.update({
                            NameObject('/V'): NameObject(on_val),
                            NameObject('/AS'): NameObject(on_val),
                        })
                        return True
    return False


def generate_form(case_data, agent_info, output_path=None):
    """
    Generate a pre-filled Form 50-162.
    
    case_data: dict with keys:
        - case_id, owner_name, phone, email, property_address, 
        - city_state_zip, county, account_number, legal_description
    
    agent_info: dict with keys:
        - name, phone, address, city_state_zip, license_number
    """
    reader = PdfReader(TEMPLATE_PATH)
    writer = PdfWriter()
    writer.append(reader)  # copies pages + form fields without buggy clone_reader_document_root
    
    county = (case_data.get('county') or '').lower()
    ad_name = COUNTY_TO_AD.get(county, f"{case_data.get('county', '')} Appraisal District")
    
    # STEP 1: Owner info
    set_field(writer, 'Appraisal District Name', ad_name)
    set_field(writer, 'Name', case_data.get('owner_name', ''))
    set_field(writer, 'Telephone Number include area code', case_data.get('phone', ''))
    
    # Parse address into street + city/state/zip if possible
    addr = case_data.get('property_address', '')
    owner_addr = case_data.get('owner_address', addr)
    owner_csz = case_data.get('owner_city_state_zip', '')
    
    set_field(writer, 'Address', owner_addr)
    set_field(writer, 'City State Zip Code', owner_csz)
    
    # STEP 2: Property identification
    check_box(writer, 'the property(ies) listed below:')
    
    # First property
    set_field(writer, 'Appraisal District Account Number_2', case_data.get('account_number', ''))
    set_field(writer, 'Physical or Situs Address of Property_2', addr)
    set_field(writer, 'Legal Description_2', case_data.get('legal_description', ''))
    
    # STEP 3: Agent info
    set_field(writer, 'Name_2', agent_info.get('name', ''))
    set_field(writer, 'Telephone Number include area code_2', agent_info.get('phone', ''))
    set_field(writer, 'Address_2', agent_info.get('address', ''))
    set_field(writer, 'City State Zip Code_2', agent_info.get('city_state_zip', ''))
    
    # STEP 4: Agent's Authority
    check_box(writer, 'all property tax matters concerning the property identified')
    
    # Confidential info = Yes (the long field name)
    check_box(writer, 'The agent identified above is authorized to receive confidential information pursuant to Tax Code §§11.48(b)(2), 22.27(b)(2), 23.123(c)(2), 23.126(c)(2), and 23.45(b)(2):')
    
    # Communications
    check_box(writer, 'all communications from the chief appraiser')
    check_box(writer, 'all communications from the appraisal review board')
    
    # STEP 5: End date
    set_field(writer, 'Date Agents Authority Ends', '12/31/2026')
    
    # STEP 6: Leave signature blank, but fill printed name + title
    set_field(writer, 'Name of Property Owner', case_data.get('owner_name', ''))
    check_box(writer, 'the property owner')
    
    # Leave Date and Signature1 BLANK
    
    # Generate output path
    if not output_path:
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        safe_name = case_data.get('case_id', 'unknown').replace('/', '-')
        output_path = os.path.join(OUTPUT_DIR, f"Form-50-162_{safe_name}.pdf")
    
    with open(output_path, 'wb') as f:
        writer.write(f)
    
    return output_path


if __name__ == '__main__':
    # Test with a sample case
    if len(sys.argv) > 1:
        case_json = json.loads(sys.argv[1])
        agent_json = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
        path = generate_form(case_json, agent_json)
        print(f"Generated: {path}")
    else:
        print("Usage: python3 form-50-162-generator.py '<case_json>' '<agent_json>'")
        print("Or import and call generate_form() directly")
