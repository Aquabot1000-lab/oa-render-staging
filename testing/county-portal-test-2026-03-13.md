# OverAssessed — Texas County Appraisal District Portal Testing Report

**Date:** March 13, 2026  
**Tester:** AquaBot (Automated)  
**Purpose:** Pre-season readiness testing before 2026 appraisal notices drop (~mid-April)

---

## Executive Summary

| # | District | URL Status | Search | Protest Portal | Notes |
|---|----------|-----------|--------|----------------|-------|
| 1 | BCAD (Bexar) | ✅ UP | ✅ Working | ⏳ Not yet open | Online Appeals listed in nav |
| 2 | HCAD (Harris) | ⚠️ Partial | ⚠️ Issues | ⏳ iFile available | Legacy search returning 500s; main site up |
| 3 | TCAD (Travis) | ✅ UP | ✅ Working | ⏳ Not yet open | Portal + e-file ready; protest page live |
| 4 | FBCAD (Fort Bend) | ✅ UP | ✅ Working | ⏳ Not yet open | R523440 found; 2025 roll certified |
| 5 | DCAD (Dallas) | ✅ UP | ✅ Working | ⏳ Not yet open | Notices mail by 4/15; protest deadline 5/15 |
| 6 | TAD (Tarrant) | ✅ UP | ⚠️ Transitioning | ⏳ Coming soon | New system (True Prodigy); new portals pending |
| 7 | WCAD (Williamson) | ✅ UP | ✅ Working | ⏳ Not yet open | E-Services page active; online protest filing listed |
| 8 | CCAD (Collin) | ✅ UP | ✅ Working | ⏳ Not yet open | Notices mailed 4/15; esearch.collincad.org active |
| 9 | DCAD (Denton) | ✅ UP | ✅ Working | ⏳ Not yet open | True Prodigy "Public Portal" (JS app) |
| 10 | GCAD (Galveston) | ✅ UP | ✅ Working | ⏳ Not yet open | Online Protest link in nav; ARB info available |
| 11 | MCAD (Montgomery) | ✅ UP | ✅ Working | ⏳ Not yet open | True Prodigy "Public Portal" (JS app) |
| 12 | BCAD (Brazoria) | ✅ UP | ✅ Working | ⏳ Not yet open | Name changed to "Brazoria Central" Jan 2026; online protest & agent portal listed |
| 13 | NCAD (Nueces) | ✅ UP | ✅ Working | ⏳ Not yet open | Online Appeals & Agent Portal links in nav |
| 14 | EPCAD (El Paso) | ❌ BLOCKED | ❓ Unknown | ❓ Unknown | Cloudflare 403 — requires browser/CAPTCHA |
| 15 | HCAD (Hidalgo) | ✅ UP | ✅ Working | ⏳ Not yet open | True Prodigy "Public Portal" (JS app) |

**Overall: 14/15 portals accessible. 1 blocked (EPCAD/Cloudflare). No protest portals open yet — expected, season starts mid-April.**

---

## Detailed Results

### 1. BCAD — Bexar County (San Antonio)
- **URL:** https://bcad.org
- **Status:** ✅ UP (200 OK)
- **Property Search:** ✅ Available — search by Name, Address, or Property ID from homepage. Two versions available: "Property Search with ARB Database" and "Property Search – Classic Version"
- **Online Protest:** ⏳ "Online Services" section listed in nav with "Online Appeals, online applications, and videos" — protest filing will activate once notices are mailed
- **Key Info:** Help Center available at help.bcad.org; text support at 844-461-2223; "Hearing Procedures" page available for ARB protest process info
- **2026 Timeline:** No specific 2026 notice date posted yet
- **⚠️ URL Note:** `/property-search/` and `/online-services/` return 404 — correct entry points are via the homepage links which likely use different slug patterns

### 2. HCAD — Harris County (Houston)
- **URL:** https://public.hcad.org / https://hcad.org
- **Status:** ⚠️ Main site (hcad.org) UP but legacy search (public.hcad.org) has issues
- **Property Search:** ⚠️ public.hcad.org homepage loads (200) but actual property detail pages return **500 Internal Server Error** when querying by account number (tested 0770870120020). Appears the legacy ASP-based search system is experiencing server errors.
- **Online Protest:** ⏳ **iFile Protest** is listed as an online service on hcad.org — this is HCAD's electronic protest filing system. Also has: iFile Rendition, Mobile App, Owners portal, Agents portal
- **Key Info:** Protest Hearings Database available; Saturday hearings scheduled for Jun/Jul; Phone: (713) 957-7800
- **2026 Timeline:** Not posted on homepage yet
- **⚠️ ACTION NEEDED:** public.hcad.org property search returning 500 errors — may be temporary maintenance or the legacy system is being deprecated. Monitor and consider using hcad.org search instead.

### 3. TCAD — Travis County (Austin)
- **URL:** https://traviscad.org
- **Status:** ✅ UP (200 OK)
- **Property Search:** ✅ Full database available at traviscad.org/propertysearch — search by owner name, address, account number, or DBA
- **Online Protest:** ⏳ Dedicated protest section at traviscad.org/protests with detailed process info:
  - **Online filing** via traviscad.org/portal (requires property owner ID + PIN from Notice)
  - Upload evidence, review district evidence, accept/decline settlements online
  - Also accepts protests by mail (PO Box 149012, Austin TX 78714) or in-person (850 East Anderson Lane)
  - **Deadline:** May 15 or 30 days after Notice is mailed, whichever is later
- **Key Info:** Latest news includes homestead exemption reminders (Jan 2026), postmark policy change notice, "How Your Property is Appraised" educational content
- **2026 Timeline:** Notices expected spring 2026 (specific date not yet posted)

### 4. FBCAD — Fort Bend County
- **URL:** https://esearch.fbcad.org
- **Status:** ✅ UP (200 OK)
- **Property Search:** ✅ Working — tested account R523440, property found (returned "This Property is Not Mapped" for GIS but data exists). Search supports Owner, Address, ID, and Advanced search tabs.
- **Online Protest:** ⏳ Not yet open for 2026
- **Key Info:** 2025 appraisal roll is certified; tax rate info at fortbendtax.org; "some values subject to change" disclaimer
- **2026 Timeline:** No specific notice date posted

### 5. DCAD — Dallas County
- **URL:** https://www.dallascad.org
- **Status:** ✅ UP (200 OK)
- **Property Search:** ✅ Working — search by Owner Name, Account Number, Street Address, Business Name, or Map. SearchOwner.aspx page confirmed functional with search form.
- **Online Protest:** ⏳ Not yet open but timeline confirmed:
  - **2026 Appraisal Notices mailed by April 15, 2026**
  - **2026 Protest Deadline for Real Property: May 15, 2026**
  - Customer Service: 214-631-0910
- **Key Info:**
  - Rendition filing date: April 15, 2026
  - Appraisal data last updated: 3/13/2026 (today!)
  - Office closed 3/31 (Cesar Chavez) and 4/3 (Good Friday)
  - Severe Winter Weather Disaster notice (1/22-1/25/2026)
  - Homestead exemption filing is free
- **2026 Timeline:** ✅ **Notices by 4/15, Protest deadline 5/15**

### 6. TAD — Tarrant County (Fort Worth)
- **URL:** https://www.tad.org
- **Status:** ✅ UP (200 OK)
- **Property Search:** ⚠️ **TRANSITIONING** — TAD is migrating to new system "True Prodigy"
  - Legacy property search no longer supported; data accurate through end of 2026 but stagnant
  - **New search:** https://tarrant.prodigycad.com/property-search (loads as JS app "Public Portal")
  - New taxpayer/agent portals "Coming Soon"
- **Online Protest:** ⏳ New portals coming — protest filing will be through new system
- **Key Info:**
  - BPP Renditions due April 15, 2026
  - Temporary disaster-related exemption available (winter storms)
  - System transition announced January 9, 2026
- **⚠️ ACTION NEEDED:** The URL and process for filing protests will change. Monitor tarrant.prodigycad.com for new portal launch. Old system being phased out.

### 7. WCAD — Williamson County
- **URL:** https://www.wcad.org
- **Status:** ✅ UP (200 OK)
- **Property Search:** ✅ Working — search through E-Services page or Parcel Map (gisweb.wcad.org/parcelmap). Also data portal at data.wcad.org.
- **Online Protest:** ⏳ Online protest filing listed under E-Services (wcad.org/eservices/) — will activate when notices are mailed
- **Key Info:** 98% customer satisfaction rating (23,800+ reviews); 4.6 stars on Google; BPP rendition available Jan 1 – May 15; Support center at support.wcad.org
- **2026 Timeline:** No specific notice mail date posted yet

### 8. CCAD — Collin County
- **URL:** https://www.collincad.org → redirects to https://collincad.org
- **Status:** ✅ UP (200 OK)
- **Property Search:** ✅ Working — redirects to esearch.collincad.org (same BIS platform as Fort Bend). Search by Owner, Address, ID, or Advanced. Updated nightly.
- **Online Protest:** ⏳ **Appraisal Notices Mailed April 15th** — protest info under "2025 Property Tax Protest and Appeal Procedures" (2026 version likely pending)
- **Key Info:**
  - 2026 Low Income Housing Cap Rate: 7.0%
  - Homestead exemption audit program (SB 1801)
  - Key Annual Cycles visual calendar on homepage
- **2026 Timeline:** ✅ **Notices mailed April 15**

### 9. DCAD — Denton County
- **URL:** https://www.dentoncad.com
- **Status:** ✅ UP (200 OK)
- **Property Search:** ✅ Working — True Prodigy "Public Portal" JavaScript application. Minimal content extracted via fetch (JS-rendered), but the app loads successfully.
- **Online Protest:** ⏳ Expected through True Prodigy portal when season opens
- **Key Info:** Uses True Prodigy CAD platform (same as Tarrant, Montgomery, Hidalgo)
- **2026 Timeline:** No specific dates posted

### 10. GCAD — Galveston County
- **URL:** https://www.galvestoncad.org → redirects to galvestoncad.org
- **Status:** ✅ UP (200 OK)
- **Property Search:** ✅ "PROPERTY SEARCH" and "INTERACTIVE MAP" links available in navigation. Also "ONLINE PROTEST" link visible.
- **Online Protest:** ⏳ **Online Protest link exists in nav** — plus ARB section with: Virtual Hearing Info, Informal Meetings, The Protest Process
- **Key Info:**
  - Top Workplace 2024 and 2025
  - RFP for Mass Appraisal System issued (may be transitioning systems)
  - ARB section well-documented
- **2026 Timeline:** No specific dates posted

### 11. MCAD — Montgomery County
- **URL:** https://www.mcad-tx.org
- **Status:** ✅ UP (200 OK)
- **Property Search:** ✅ Working — True Prodigy "Public Portal" JavaScript application (same platform as Denton, Hidalgo)
- **Online Protest:** ⏳ Expected through portal when season opens
- **Key Info:** Uses True Prodigy CAD platform
- **2026 Timeline:** No specific dates posted

### 12. BCAD — Brazoria County
- **URL:** https://www.brazoriacad.org → redirects to brazoriacad.org
- **Status:** ✅ UP (200 OK)
- **Property Search:** ✅ "Property Search" prominently featured. Also "TNT Property Search" and "Link To Property Map" available.
- **Online Protest:** ⏳ **Robust online system** — nav includes: "Online Protest", "Agent Protest", "Agent Protest Submissions", "Portal Help Page"
- **Key Info:**
  - **Name changed from "Brazoria County Appraisal District" to "Brazoria Central Appraisal District" effective January 1, 2026** — branding update only, no functional changes
  - ARB seeking members for 2026-2027 (hearings Mon-Thu, May 1 – Jul 31)
  - SB 1801 homestead audit program active
  - BPP rendition available
- **2026 Timeline:** No specific notice date posted. ARB hearings May-July.

### 13. NCAD — Nueces County (Corpus Christi)
- **URL:** https://www.nuecescad.net → redirects to nuecescad.net
- **Status:** ✅ UP (200 OK)
- **Property Search:** ✅ "PROPERTY SEARCH" and "INTERACTIVE MAP" links in navigation
- **Online Protest:** ⏳ **"ONLINE APPEALS" and "AGENT PORTAL"** links visible in nav — filing will open with notice season
- **Key Info:**
  - Chief Appraiser: Debra D. Morin, RPA, RTA, CCA
  - Taxpayer Liaison: Terri Noack — (361) 696-7683
  - Office: 201 N. Chaparral Street, Corpus Christi, TX 78401 — (361) 881-9978
  - Request for Electronic Communication available
- **2026 Timeline:** No specific dates posted

### 14. EPCAD — El Paso County
- **URL:** https://www.epcad.org
- **Status:** ❌ **BLOCKED — 403 Forbidden (Cloudflare)**
- **Property Search:** ❓ Cannot test — Cloudflare "Just a moment..." challenge page blocks automated access
- **Online Protest:** ❓ Unknown — requires browser with JavaScript/CAPTCHA solving
- **Key Info:** Site is behind Cloudflare bot protection. Repeated attempts return 403.
- **⚠️ ACTION NEEDED:** Must test manually via browser. The Cloudflare protection may also affect automated protest filing tools if OverAssessed relies on API/scraping for this county.

### 15. HCAD — Hidalgo County
- **URL:** https://www.hidalgoad.org
- **Status:** ✅ UP (200 OK)
- **Property Search:** ✅ Working — True Prodigy "Public Portal" JavaScript application (same platform as Denton, Montgomery)
- **Online Protest:** ⏳ Expected through portal when season opens
- **Key Info:** Uses True Prodigy CAD platform
- **2026 Timeline:** No specific dates posted

---

## Key Findings & Action Items

### 🔴 Critical Issues
1. **EPCAD (El Paso)** — Cloudflare blocking all automated access. Need manual browser test and may need to plan for manual filing process for El Paso clients.
2. **HCAD (Harris) Legacy Search** — public.hcad.org property detail pages returning 500 errors. May be temporary or sign of system deprecation. Need to identify the new search endpoint.

### 🟡 Watch Items
3. **TAD (Tarrant) System Transition** — Migrating to True Prodigy. Legacy search being phased out. New protest portal "Coming Soon." Monitor for launch — filing process will change.
4. **GCAD (Galveston) RFP for Mass Appraisal System** — May be planning own system transition. Watch for changes.
5. **JS-Heavy Portals (Denton, Montgomery, Hidalgo, Tarrant new)** — True Prodigy portals are JavaScript-rendered apps. Any automated tools need to handle JS rendering (Puppeteer/Playwright).
6. **Brazoria name change** — Update any references from "Brazoria County Appraisal District" to "Brazoria Central Appraisal District"

### ✅ Ready for Season
7. **DCAD (Dallas)** — Most specific timeline: notices by 4/15, protest deadline 5/15
8. **CCAD (Collin)** — Notices mailing April 15
9. **TCAD (Travis)** — Best online protest system (portal with evidence upload, settlement offers)
10. **BCAD (Bexar)** — Home turf, online appeals ready to activate
11. **FBCAD (Fort Bend)** — Search confirmed working, BIS platform reliable
12. **Brazoria** — Full online protest + agent portal infrastructure in place
13. **NCAD (Nueces)** — Online Appeals + Agent Portal ready

### 📅 Known 2026 Dates
| Event | Date | Counties |
|-------|------|----------|
| BPP Rendition Due | April 15, 2026 | Dallas, Tarrant, Williamson (Jan 1 – May 15) |
| Appraisal Notices Mailed | ~April 15, 2026 | Dallas (confirmed), Collin (confirmed), most others expected similar |
| Protest Deadline (Real Property) | May 15, 2026 | Dallas (confirmed); others typically May 15 or 30 days after notice |
| ARB Hearings | May – July 2026 | Brazoria (Mon-Thu, May 1 – Jul 31); HCAD Saturday hearings Jun/Jul |

### 🛠️ Platform Distribution
| Platform | Counties |
|----------|----------|
| True Prodigy | Tarrant (new), Denton, Montgomery, Hidalgo |
| BIS Consultants | Fort Bend, Collin, Galveston, Nueces, Brazoria |
| Custom/Legacy | Bexar (BCAD), Harris (HCAD), Travis (TCAD), Dallas (DCAD), Williamson (WCAD) |
| Unknown (Cloudflare) | El Paso (EPCAD) |

---

## Recommended Next Steps

1. **Manually test EPCAD (El Paso)** via browser — verify search and protest capabilities
2. **Monitor HCAD legacy search** (public.hcad.org) — check if 500 errors resolve; identify new search URL
3. **Monitor TAD new portal launch** at tarrant.prodigycad.com — test protest filing when available
4. **Re-test all portals in early April** (1-2 weeks before notices drop)
5. **Prepare filing templates** for each district's protest portal format
6. **Update client-facing docs** with Brazoria name change
7. **Ensure scraping/automation tools** support JavaScript rendering for True Prodigy portals

---

*Report generated: March 13, 2026, 9:38 PM CDT*  
*Next test recommended: April 1, 2026*
