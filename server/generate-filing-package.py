#!/usr/bin/env python3
"""
Filing Review Package PDF Generator
Generates a professional PDF for Tyler to review before any client contact.
"""

import json, sys, os, math
from datetime import datetime
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

NAVY = HexColor('#1a2332')
BLUE = HexColor('#2563eb')
GREEN = HexColor('#16a34a')
RED = HexColor('#dc2626')
GRAY = HexColor('#6b7280')
LIGHT_BG = HexColor('#f8fafc')
WHITE = HexColor('#ffffff')
BORDER = HexColor('#e2e8f0')

def money(val):
    try:
        v = float(str(val).replace('$','').replace(',',''))
        return f"${v:,.0f}"
    except:
        return str(val) if val else "N/A"

def generate_package(lead, output_path):
    doc = SimpleDocTemplate(output_path, pagesize=letter,
                           leftMargin=0.75*inch, rightMargin=0.75*inch,
                           topMargin=0.5*inch, bottomMargin=0.5*inch)
    
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle('Title', parent=styles['Title'],
        fontSize=20, textColor=NAVY, spaceAfter=4, fontName='Helvetica-Bold')
    subtitle_style = ParagraphStyle('Subtitle', parent=styles['Normal'],
        fontSize=11, textColor=GRAY, spaceAfter=16)
    section_style = ParagraphStyle('Section', parent=styles['Heading2'],
        fontSize=14, textColor=BLUE, spaceBefore=16, spaceAfter=8,
        fontName='Helvetica-Bold', borderPadding=(0,0,4,0))
    normal = ParagraphStyle('Body', parent=styles['Normal'],
        fontSize=10, textColor=NAVY, leading=14)
    small = ParagraphStyle('Small', parent=styles['Normal'],
        fontSize=8, textColor=GRAY)
    bold_style = ParagraphStyle('Bold', parent=normal, fontName='Helvetica-Bold')
    
    # Build elements
    elements = []
    
    # Header
    case_id = lead.get('case_id', '?')
    owner = lead.get('owner_name', '?')
    now = datetime.now().strftime('%B %d, %Y at %I:%M %p')
    
    elements.append(Paragraph(f"FILING REVIEW PACKAGE", title_style))
    elements.append(Paragraph(f"{case_id} — {owner}", subtitle_style))
    elements.append(Paragraph(f"Generated: {now} | FOR INTERNAL REVIEW ONLY", small))
    elements.append(HRFlowable(width="100%", thickness=2, color=BLUE, spaceAfter=12))
    
    # TX TDLR Warning
    state = (lead.get('state') or '').strip().upper()
    if state == 'TX':
        warn_style = ParagraphStyle('Warn', parent=bold_style, textColor=RED, fontSize=11)
        elements.append(Paragraph("⚠️ TEXAS: TDLR LICENSE REQUIRED BEFORE FILING. This package is for analysis review and agreement signing ONLY. Do NOT file protest until TDLR status confirmed.", warn_style))
        elements.append(Spacer(1, 8))
    
    # ═══ SECTION 1: SUBJECT PROPERTY ═══
    elements.append(Paragraph("1. SUBJECT PROPERTY", section_style))
    
    assessed = lead.get('assessed_value', '')
    sqft = lead.get('sqft') or lead.get('square_footage') or lead.get('property_sqft') or 'N/A'
    year_built = lead.get('year_built') or 'N/A'
    beds = lead.get('bedrooms') or 'N/A'
    baths = lead.get('bathrooms') or 'N/A'
    lot = lead.get('lot_size') or 'N/A'
    county = lead.get('county', '?')
    
    prop_data = [
        ['Address', lead.get('property_address', 'N/A')],
        ['County / State', f"{county}, {lead.get('state', '?')}"],
        ['Assessed Value', money(assessed)],
        ['Square Footage', str(sqft)],
        ['Year Built', str(year_built)],
        ['Bedrooms / Bathrooms', f"{beds} / {baths}"],
        ['Lot Size', str(lot)],
    ]
    
    t = Table(prop_data, colWidths=[2*inch, 4.5*inch])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), LIGHT_BG),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('TEXTCOLOR', (0, 0), (-1, -1), NAVY),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    elements.append(t)
    
    # ═══ SECTION 2: COMPARABLE SALES ═══
    elements.append(Paragraph("2. COMPARABLE SALES", section_style))
    
    cr = lead.get('comp_results') or {}
    comps = cr.get('comps') or []
    
    if not comps:
        elements.append(Paragraph("No comparable sales available.", normal))
    else:
        comp_header = ['#', 'Address', 'Sale Price', 'Sale Date', 'SqFt', 'Distance']
        comp_rows = [comp_header]
        
        for i, c in enumerate(comps[:5], 1):
            addr = c.get('address', 'N/A')
            if len(addr) > 40:
                addr = addr[:38] + '..'
            comp_rows.append([
                str(i),
                addr,
                money(c.get('sale_price', c.get('price', 'N/A'))),
                str(c.get('sale_date', 'N/A'))[:10],
                str(c.get('sqft', c.get('square_footage', 'N/A'))),
                f"{c.get('distance_miles', '?')} mi"
            ])
        
        t = Table(comp_rows, colWidths=[0.35*inch, 2.5*inch, 1.1*inch, 0.95*inch, 0.7*inch, 0.9*inch])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), BLUE),
            ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('TEXTCOLOR', (0, 1), (-1, -1), NAVY),
            ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, LIGHT_BG]),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
            ('RIGHTPADDING', (0, 0), (-1, -1), 6),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]))
        elements.append(t)
        
        # Comp statistics
        elements.append(Spacer(1, 8))
        distances = [float(c.get('distance_miles', 0)) for c in comps if c.get('distance_miles') is not None]
        ages = []
        now_dt = datetime.now()
        for c in comps:
            sd = c.get('sale_date', '')
            if sd:
                try:
                    d = datetime.strptime(str(sd)[:10], '%Y-%m-%d')
                    ages.append((now_dt - d).days)
                except:
                    pass
        prices = []
        for c in comps:
            try:
                p = float(str(c.get('sale_price', c.get('price', '0'))).replace('$','').replace(',',''))
                if p > 0:
                    prices.append(p)
            except:
                pass
        
        avg_dist = f"{sum(distances)/len(distances):.2f} mi" if distances else "N/A"
        avg_age = f"{sum(ages)//len(ages)} days" if ages else "N/A"
        avg_price = money(sum(prices)/len(prices)) if prices else "N/A"
        median_price = money(sorted(prices)[len(prices)//2]) if prices else "N/A"
        
        stats = f"<b>Avg Distance:</b> {avg_dist} | <b>Avg Sale Age:</b> {avg_age} | <b>Avg Sale Price:</b> {avg_price} | <b>Median Price:</b> {median_price}"
        elements.append(Paragraph(stats, normal))
    
    # ═══ SECTION 3: VALUATION SUMMARY ═══
    elements.append(Paragraph("3. VALUATION SUMMARY", section_style))
    
    savings = lead.get('estimated_savings', 0)
    try:
        assessed_val = float(str(assessed).replace('$','').replace(',',''))
    except:
        assessed_val = 0
    
    proposed = cr.get('proposed_value') or cr.get('estimated_market_value')
    if not proposed and prices:
        proposed = sum(prices) / len(prices)
    
    pct_over = 0
    if assessed_val > 0 and proposed:
        try:
            proposed_val = float(str(proposed).replace('$','').replace(',',''))
            pct_over = ((assessed_val - proposed_val) / assessed_val) * 100
        except:
            pass
    
    val_data = [
        ['County Assessed Value', money(assessed)],
        ['Proposed Market Value (comps)', money(proposed) if proposed else 'N/A'],
        ['Over-Assessment', f"{pct_over:.1f}%" if pct_over > 0 else 'N/A'],
        ['Estimated Annual Savings', money(savings)],
        ['Revenue (25% of savings)', money(float(savings) * 0.25) if savings else 'N/A'],
    ]
    
    t = Table(val_data, colWidths=[2.5*inch, 4*inch])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), LIGHT_BG),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('TEXTCOLOR', (0, 0), (-1, -1), NAVY),
        ('BACKGROUND', (1, 3), (1, 3), HexColor('#dcfce7')),  # Highlight savings
        ('FONTNAME', (1, 3), (1, 4), 'Helvetica-Bold'),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    elements.append(t)
    
    # ═══ SECTION 4: DATA SOURCES ═══
    elements.append(Paragraph("4. DATA SOURCES", section_style))
    
    source = cr.get('source') or cr.get('data_source') or 'RentCast API + County Records'
    qa = lead.get('qa_status', 'not_run')
    
    src_data = [
        ['Comp Source', str(source)],
        ['QA Status', qa.upper()],
        ['Comps Available', str(len(comps))],
        ['Agreement Type', lead.get('agreement_type', 'none')],
        ['Fee Agreement Signed', 'Yes' if lead.get('fee_agreement_signed') else 'No'],
        ['$79 Initiation Paid', 'Yes' if (lead.get('initiation_paid') or lead.get('initiation_fee_paid')) else 'No'],
    ]
    
    t = Table(src_data, colWidths=[2.5*inch, 4*inch])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), LIGHT_BG),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('TEXTCOLOR', (0, 0), (-1, -1), NAVY),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    elements.append(t)
    
    # ═══ SECTION 5: APPROVAL CHECKLIST ═══
    elements.append(Paragraph("5. APPROVAL CHECKLIST", section_style))
    
    checks = [
        ('QA Passed', qa == 'passed'),
        ('3+ Comps Available', len(comps) >= 3),
        ('All Comps Have Sale Dates', all(c.get('sale_date') for c in comps) if comps else False),
        ('Assessed Value Present', assessed_val > 0),
        ('Savings > $0', float(savings or 0) > 0),
        ('Agreement Signed', bool(lead.get('fee_agreement_signed'))),
        ('$79 Paid', bool(lead.get('initiation_paid') or lead.get('initiation_fee_paid') or lead.get('agreement_type') == 'legacy_terms')),
    ]
    
    if state == 'TX':
        checks.append(('TDLR License Confirmed', False))  # Always false until confirmed
    
    check_rows = []
    for label, ok in checks:
        check_rows.append([
            '✅' if ok else '❌',
            label,
            'PASS' if ok else 'FAIL'
        ])
    
    t = Table(check_rows, colWidths=[0.4*inch, 4*inch, 2.1*inch])
    t.setStyle(TableStyle([
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('TEXTCOLOR', (0, 0), (-1, -1), NAVY),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    elements.append(t)
    
    # Footer
    elements.append(Spacer(1, 20))
    elements.append(HRFlowable(width="100%", thickness=1, color=GRAY))
    elements.append(Paragraph("This document is for internal review only. No client communication or filing may proceed without Tyler Worthey's explicit approval.", small))
    
    doc.build(elements)
    return output_path


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 generate-filing-package.py <lead_json> [output_path]")
        sys.exit(1)
    
    lead = json.loads(sys.argv[1])
    out = sys.argv[2] if len(sys.argv) > 2 else f"/tmp/filing-package-{lead.get('case_id','unknown')}.pdf"
    generate_package(lead, out)
    print(f"Generated: {out}")
