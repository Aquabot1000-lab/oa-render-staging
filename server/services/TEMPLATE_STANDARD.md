# TaxNet_v1_APPROVED — LOCKED TEMPLATE

**Version:** v1
**Status:** APPROVED — DO NOT MODIFY WITHOUT VERSION BUMP
**Locked by:** Tyler Worthey (2026-04-15)
**Based on:** OA-0027 v4 output

---

## Template Structure (fixed — every package, every case)

### Page 1: Form 50-132 (Portrait, Letter)
1. Title: "Notice of Protest"
2. Subtitle: "Form 50-132 | Before the Appraisal Review Board"
3. Citation: "Tax Code §41.41, §41.44, §41.45"
4. Horizontal rule
5. District: [County] County Appraisal District | Tax Year: 2026
6. Property Owner: Name, Address, Phone, Email
7. Agent: OverAssessed, LLC | 6002 Camp Bullis Suite 208 | (888) 282-9165
8. Property Description: Account #, Address
9. Protest Grounds: ☑ §41.41(a)(1) + ☑ §41.41(a)(2)
10. Values: Appraised + Opinion
11. Signature line + Print Name

### Pages 2+: E&U Comp Grid (Landscape, Letter, 3 comps per page)
1. Dark charcoal bar (#333333): "Equal & Uniform Analysis" centered white text
2. Property info row (bordered): Address left, Tax ID + Owner right
3. Indicated Value bar (#333333): "Indicated Value $XXX,XXX" white text left, stats right
4. Grid: Label column (115px) + Subject column + 3 Comp columns
5. Header row (#333333): "(CAD 2026)" | "SUBJECT" | "COMP 1" | "COMP 2" | "COMP 3"

#### Grid Rows (FIXED ORDER — no variation):
| Row | Label |
|-----|-------|
| 1 | Tax ID |
| 2 | Address |
| 3 | Market Value |
| 4 | Distance (Miles) |
| 5 | Property Class |
| 6 | Condition |
| 7 | Year Built |
| 8 | Main SQFT (PSF) |
| 9 | Improvement Value |
| 10 | Land Value |
| 11 | Acres |
| 12 | (spacer) |
| 13 | Age Adjustment |
| 14 | Size Adjustment |
| 15 | Land Adjustment |
| 16 | Condition Adjustment |
| 17 | Net Adjustment |
| 18 | **Total Adjusted Value** (dark charcoal bar, white text) |

#### Grid Styling (FIXED):
- Alternating rows: #F5F5F5 / white
- All cells: 0.5pt black border
- Adjustment rows: 6pt font
- Data rows: 7pt font
- Net Adjustment: Helvetica-Bold
- Total Adjusted Value: #333333 background, white Helvetica-Bold 7pt

#### Footer:
- 6pt #666 text centered: "Account: XXX | County | Date | Page X | OverAssessed, LLC"

### Last Page: Evidence Summary (Portrait, Letter)
1. Title: "Evidence Summary & Protest Argument" centered bold
2. $/Sq Ft Comparison: Subject vs Comp Avg
3. Protest Argument (numbered):
   - 1. OVERVALUATION
   - 2. UNEQUAL APPRAISAL §41.41(a)(2)
   - 3. EXCESS ACREAGE (if acres > 2)
4. REQUESTED RELIEF: "Reduce from $X to $Y"

---

## Version History
| Version | Date | Change | Approved By |
|---------|------|--------|-------------|
| v1 | 2026-04-15 | Initial approved layout (from OA-0027 v4) | Tyler Worthey |

## Rules
- NO layout changes without version bump
- NO dynamic sections per case
- Data changes only (names, values, comps)
- Version bump requires Tyler approval
