# PROTEST PACKAGE STANDARD — CANONICAL REFERENCE
**Version: 2.0 | Approved: 2026-04-28 | Authority: Tyler Worthey**

> **2026-04-28 LOCKDOWN (msg 27013):** "all other customers must be exactly the same as this one! No exceptions."
> Reference build: OA-0027 Villarreal internal-review v2 (md5 `1db4fd34c7402043d3def0974636a4de`).
> Reference Sherman package: OA-0037 (`OA-0037-Sherman-Protest-Package_13.pdf`).
> ALL filing packages — every customer, every county, every case — MUST be produced by `gen-taxnet-master-v1.js`. No exceptions, no per-case variants, no rural-acreage carve-outs, no methodology overrides.
> Any prior "approved" carve-out (Option B-1, build-bexar-acreage-review.js, gen-taxnet-final.js direct calls, etc.) is REVOKED.

---

## APPROVED FORMAT

The only valid protest package format is the **Sherman/TaxNet USA Equal & Uniform style** as produced by `server/scripts/gen-taxnet-master-v1.js` (Spec v1.1). The reference is OA-0037 Sherman package (8 pages) and OA-0027 Villarreal v2 (6 pages — same structure, fewer comps so fewer E&U pages).

### Package Structure (per filing)
1. **Form 50-132** — Notice of Protest (pre-filled, owner signs)
2. **Equal & Uniform Analysis** — TaxNet USA comp grid, typically 12 comps with adjustments
3. No cover letters. No separate maps. No additional narrative pages.

### Form 50-132 Required Fields
- District: `{County} County Appraisal District`
- Tax Year: current year
- Owner name (from submissions)
- Agent: `OverAssessed, LLC`
- Agent address: `6002 Camp Bullis, Suite 208, San Antonio, TX 78257`
- Agent phone: **(888) 282-9165**
- Agent email: **info@overassessed.ai**
- Account # (from property_data.accountId)
- Geo ID (from property_data — the formatted geo ID)
- Legal description
- Protest grounds: §41.41(a)(1) AND §41.41(a)(2) — both checked
- District Appraised: value from official CAD notice
- Owner Opinion: recommended value from TaxNet E&U analysis
- Signature block: blank (owner signs)

### Equal & Uniform Analysis Layout
- Header: property address, Tax ID, owner name
- Indicated Value (recommended), comp count, min/max adjusted values, appraised value
- County + date + page X of N
- Footer: `Confidential © 2026 OverAssessed, LLC (CAD 2026)`
- Comp grid columns: Tax ID, Address, Market Value, Distance (miles), Property Class, Condition, Year Built (Effective), Main SQFT (PSF), Improvement Value, Feature Value, Pool Value, Land Value, Age/Size/Land/Feature/Pool adjustments ($ and %), Net Adjustment, Total Adjusted Value
- Subject row: first row, labeled SUBJECT
- Comp rows: COMP 1 through COMP N
- Final row: MEDIAN COMP

### Comp Requirements
- **Source: TaxNetUSA ONLY** for Texas cases
- Minimum 5 comps; target 10–12
- All comps must be same county
- Must have real assessed values (not estimated/synthetic)

### Valuation Methodology
- Adjustments: Age, Size, Land, Features, Pool
- Recommended value = median of total adjusted values
- Reduction % stated explicitly (e.g., "2.5% reduction")

---

## APPROVED GENERATOR — SINGLE SOURCE OF TRUTH

| Generator | Status | md5 (locked) | Output |
|---|---|---|---|
| `server/scripts/gen-taxnet-master-v1.js` | ✅ **THE ONLY APPROVED GENERATOR** | `1704dac8557897dd0356b27871895f94` | `server/filing-packages/{CASE_ID}-Filing-Package-v1.pdf` |

Usage:
```
node server/scripts/gen-taxnet-master-v1.js --case <CASE_ID> --approved-by-tyler
```

- Page 1: Form 50-132 Notice of Protest (STEPS 1–6, §41.41 grounds)
- Pages 2–N: Equal & Uniform Analysis grid (Sherman pattern)
- Trailing pages: Evidence Summary, Subject map, Comps map

Dependencies (also locked, do not modify):
- `server/lib/protest-package/package-renderer.js` — page renderer (Form 50-132 + E&U + maps)
- `server/lib/protest-package/preflight.js` — D1–D14 validation gates
- `server/lib/protest-package/postflight.js` — reconciliation gates
- `server/lib/protest-package/live-case-loader.js` — CRM/case manifest reader
- `server/lib/state-engine/manifest-registry.js` — case registry
- `server/services/taxnet-package-generator.js` — adjustment math (calcAdjustments)
- `server/services/map-generator.js` — Nominatim geocode + OSM tiles

---

## DEPRECATED / DISABLED — ALL OTHER PDF-PRODUCING SCRIPTS

Per Tyler msg 27013 (2026-04-28): **none of these may be used to build a customer protest package, internal review, or filing.** They produce a non-Sherman layout (missing Form 50-132, wrong footer, wrong adjustment math, etc.):

| File | Status | Reason |
|---|---|---|
| `scripts/gen-taxnet-final.js` | ⛔ DEPRECATED for any package build | Missing Form 50-132 page; wrong adjustment math (caused OA-0027 failure 2026-04-28) |
| `scripts/gen-taxnet-pdf.js` | ⛔ DEPRECATED | Pre-Spec-v1.1 layout |
| `scripts/gen-taxnet-v3.js` / `v4.js` / `v5.js` | ⛔ DEPRECATED | Pre-Spec-v1.1 layout |
| `scripts/gen-all-protests.js` | ⛔ DEPRECATED | Old layout |
| `scripts/gen-final-review.js` | ⛔ DEPRECATED | Old layout |
| `scripts/gen-fix-protests.js` | ⛔ DEPRECATED | Old layout |
| `scripts/gen-pdfs-v2.js` | ⛔ DEPRECATED | Old layout |
| `scripts/gen-protest-filing.js` | ⛔ DEPRECATED | Old layout |
| `scripts/gen-upload-evidence-11.js` | ⛔ DEPRECATED | Wrong format |
| `scripts/gen-oa0022-market-value-v3.js` | ⛔ DEPRECATED | One-off |
| `scripts/build-oa0013-v4.js` | ⛔ DEPRECATED | One-off |
| `scripts/build-oa-0025-package.js` | ⛔ DEPRECATED | One-off |
| `scripts/build-oa0022-market-value.js` | ⛔ DEPRECATED | One-off |
| `scripts/build-bexar-acreage-review.js` | ⛔ DEPRECATED — REVOKED | Rural-acreage carve-out revoked by msg 26951 + msg 27013 |
| `scripts/_villarreal_run.js` | ⛔ DEPRECATED | One-off Villarreal sandbox using wrong generator |
| `scripts/generate-protest-pdfs.js` | ⛔ DEPRECATED | Old layout |
| `services/evidence-generator.js` | ⛔ DEPRECATED for filing | Wrong format |
| `filing-automation/lib/cover-letter.js` | ⛔ DEPRECATED for filing | Cover letters not part of approved format |
| `filing-automation/lib/filing-pack-builder.js` | ⛔ DEPRECATED for filing | Assembles wrong documents |

**Rule:** if a script is in this list, it does not produce a customer-deliverable PDF. Use only `gen-taxnet-master-v1.js`. Period.

---

## FILING PIPELINE — CANONICAL PATHS

```
APPROVED PACKAGES:  filing-packages/{CASE_ID}-Filing-Package.pdf
AOA FORMS:          generated-forms/form-50-162-{CASE_ID}.pdf
EMAIL RUNNER:       filing-automation/runners/email-runner.js
GATE:               filing-automation/lib/filing-gate.js
ORCHESTRATOR:       filing-automation/orchestrator.js
```

---

## HARD GATE — BEFORE ANY PACKAGE IS EMAILED

1. `filing-packages/{CASE_ID}-Filing-Package.pdf` must exist (TaxNet format)
2. `generated-forms/form-50-162-{CASE_ID}.pdf` must exist (AOA)
3. All 9 gate checks must pass (see filing-gate.js)
4. Tyler must explicitly say "APPROVED TO FILE" or "file {CASE_ID}"

---

## WHAT IS NEVER VALID
- `evidence-packets/` PDFs attached to filing emails
- Cover letters from `filing-automation/filing-packs/`
- Packages using Rentcast data as comp source
- Packages with synthetic or estimated comps
- Out-of-state cases through TX filing pipeline
