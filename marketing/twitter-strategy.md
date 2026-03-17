# Twitter/X Marketing Strategy

**Brands:** OverAssessed (OA) + ProfitBlueprintCo (PBC)
**Created:** 2026-03-16
**Status:** Content ready — awaiting Twitter API access

---

## 🔑 API Access Required

### What We Need
1. **Twitter Developer Account** — Apply at [developer.twitter.com](https://developer.twitter.com)
2. **Free tier** is sufficient to start (1,500 tweets/month write access)
3. **OAuth 1.0a credentials** (per account):
   - API Key + API Secret
   - Access Token + Access Token Secret
4. **Python dependency:** `pip3 install requests requests-oauthlib`

### Recommended Setup
- **Two separate Twitter accounts** — one for each brand
- **Suggested handles:**
  - OA: `@OverAssessedTax` or `@OverAssessedAI`
  - PBC: `@ProfitBlueprint` or `@ProfitBlueprintCo`
- Each account needs its own Developer App in the Twitter Developer Portal
- Set apps to "Read and Write" permissions

### Steps to Get Running
1. Tyler creates/claims Twitter accounts for both brands
2. Apply for Twitter Developer access (Free tier)
3. Create a "Project" and "App" for each brand in the Developer Portal
4. Generate OAuth 1.0a keys for each app
5. Set environment variables (see `tweet.sh` for names)
6. Test with `./tweet.sh twitter-oa-posts.json --dry-run`
7. Post first tweet: `./tweet.sh twitter-oa-posts.json`

---

## 📋 Content Strategy: OverAssessed

### Account Purpose
Position OverAssessed as THE trusted property tax protest authority in TX and GA. Drive signups at overassessed.ai.

### Content Pillars (4-3-2-1 ratio per 10 tweets)
| Pillar | Count | Examples |
|--------|-------|---------|
| **Educational** | 4 | Tax tips, how protests work, rights homeowners have |
| **Urgency/Deadlines** | 3 | Filing deadlines, "don't miss" reminders, seasonal pushes |
| **Social Proof/Stats** | 2 | Savings stats, success rates, industry data |
| **Direct CTA** | 1 | Sign up, visit overassessed.ai, "we handle everything" |

### Voice & Tone
- **Confident but not salesy** — we're the expert friend, not an infomercial
- **Slightly provocative** — "Your county WANTS you to overpay" gets engagement
- **Empowering** — teach people their rights, then offer to help

### Posting Schedule
- **Frequency:** 4-5 tweets/week (Mon, Tue, Thu, Fri + optional Wed)
- **Best times:** 7-9 AM CT, 12-1 PM CT, 5-7 PM CT
- **Seasonal ramp:** Increase to daily in April-May (protest deadline season)

### Hashtag Strategy
Primary: `#PropertyTax` `#OverAssessed` `#TaxProtest`
TX-specific: `#Texas` `#SanAntonio` `#BexarCounty` `#DFW` `#Houston` `#Austin`
GA-specific: `#Georgia` `#Atlanta` `#FultonCounty` `#DeKalbCounty`
General: `#Homeowners` `#SaveMoney` `#PersonalFinance` `#RealEstate`

### Growth Tactics
1. **Engage local real estate accounts** — reply to TX/GA realtors, home-buying content
2. **Quote-tweet news** about rising property values / tax hikes with our take
3. **Thread format** for deep-dive content (e.g., "5-step protest guide" thread)
4. **Pin tweet** with clearest value prop + CTA
5. **Seasonal campaigns:**
   - Jan-Feb: "New year, time to review your assessment"
   - Mar-Apr: "Notices arriving — here's what to do"
   - May: "DEADLINE APPROACHING" urgency push
   - Jun-Aug: "Hearing season — we're fighting for our clients"
   - Sep-Dec: "Results are in — here's what we saved"

---

## 📋 Content Strategy: ProfitBlueprintCo

### Account Purpose
Build PBC as a go-to brand for practical business spreadsheet templates. Drive traffic to Etsy shop and Lemon Squeezy store.

### Content Pillars (3-4-2-1 ratio per 10 tweets)
| Pillar | Count | Examples |
|--------|-------|---------|
| **Tips & Hacks** | 4 | Excel/Sheets tips, formulas, shortcuts |
| **Product Showcase** | 3 | Template previews, new drops, use cases |
| **Small Biz Advice** | 2 | Finance tips, business organization |
| **Behind the Scenes** | 1 | How we build templates, quality process |

### Voice & Tone
- **Helpful nerd energy** — we genuinely love spreadsheets
- **Practical** — every tip should be immediately usable
- **Anti-complexity** — "you don't need expensive software" messaging

### Posting Schedule
- **Frequency:** 3-4 tweets/week (Tue, Thu, Sat + optional Mon)
- **Best times:** 8-10 AM CT, 12-1 PM CT
- **Product drops:** Always on Tuesday or Thursday

### Hashtag Strategy
Primary: `#Spreadsheets` `#ExcelTips` `#GoogleSheets`
Business: `#SmallBusiness` `#Freelancer` `#Entrepreneur`
Product: `#Templates` `#Productivity` `#Finance`

### Growth Tactics
1. **Excel/Sheets tip threads** — high engagement, high save rate
2. **Before/after** template screenshots (messy notebook → clean spreadsheet)
3. **Engage #SmallBusiness and #Freelancer communities**
4. **Cross-promote** with Etsy shop link in bio
5. **Reply to finance/business questions** with genuine help (not spam)

---

## 📁 File Locations

| File | Path |
|------|------|
| OA tweets (15) | `/Users/aquabot/Documents/social-posting/twitter-oa-posts.json` |
| PBC tweets (10) | `/Users/aquabot/Documents/social-posting/twitter-pbc-posts.json` |
| Posting script | `/Users/aquabot/Documents/social-posting/tweet.sh` |
| This strategy | `/Users/aquabot/Documents/OverAssessed/marketing/twitter-strategy.md` |

## 🔄 Automation Plan

Once API access is ready:
1. Set env vars in a `.env` file (gitignored)
2. Source the env and run `tweet.sh` per brand on a schedule
3. Can integrate with cron or OpenClaw heartbeat for automated posting
4. Script marks tweets as posted in the JSON — add more tweets to the array as needed

---

## 📊 KPIs to Track

| Metric | OA Target (90 days) | PBC Target (90 days) |
|--------|---------------------|----------------------|
| Followers | 500 | 300 |
| Avg. impressions/tweet | 1,000 | 500 |
| Link clicks to site | 200/mo | 100/mo |
| Engagement rate | 3%+ | 4%+ |
| Signups/sales attributed | 20 signups | 10 sales |

---

*Next step: Tyler creates Twitter accounts and applies for Developer access. Content is ready to post immediately once connected.*
