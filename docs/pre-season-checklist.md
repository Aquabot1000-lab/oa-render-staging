# Pre-Season Marketing Checklist — TX Property Tax Protest 2026

**Timeline:** Notices drop mid-April 2026, May 15 deadline to file.
**Status as of March 4, 2026:** ~6 weeks until go-live.

---

## ✅ COMPLETED

### Website & SEO
- ✅ 15 county SEO landing pages live (Bexar, Harris, Dallas, Tarrant, Travis, Comal, Guadalupe, Hays, Williamson, Collin, Denton, Fort Bend, Montgomery, El Paso, Hidalgo)
- ✅ Pre-registration page live at `/pre-register`
- ✅ Property tax savings calculator live at `/calculator`
- ✅ Exemption filing page live at `/exemptions`
- ✅ Referral program page live at `/referrals`
- ✅ Main landing page optimized
- ✅ Google site verification DNS record added (TXT record)
- ✅ Sitemap.xml generated and ready for GSC submission

### Tracking & Analytics
- ✅ Google Ads gtag.js installed (AW-3513438695) on all pages
- ✅ Meta Pixel installed on PPC pages (ID: 3217197875118119)
- ✅ Conversion event placeholders added to key pages (form submissions, phone calls, pre-reg)

### Email & CRM
- ✅ SendGrid account configured
- ✅ Email sequences written:
  - Pre-registration drip campaign (5 emails)
  - Post-signup nurture sequence (4 emails)
  - Referral nudge series (3 emails)
  - Win notification email
- ✅ Supabase database configured for lead capture

### Advertising Assets
- ✅ 5 PPC landing pages created (main + Bexar, Harris, Dallas, Tarrant)
- ✅ UTM tracking implemented on all PPC pages
- ✅ Meta Pixel + Google Ads tags on all PPC pages

---

## 🟡 IN PROGRESS / NEEDS COMPLETION

### Google Search Console
- **Status:** DNS verification complete, awaiting GSC manual setup
- **Action Required:** Tyler needs to:
  1. Go to https://search.google.com/search-console
  2. Add property: `overassessed.ai`
  3. Select TXT verification (already in DNS)
  4. Click "Verify"
  5. Submit sitemap: `https://overassessed.ai/sitemap.xml`
- **Timeline:** Do this ASAP (allows Google to start indexing before April)
- **Instructions:** See `scripts/gsc-submit.sh`

### SendGrid Domain Authentication
- **Status:** CNAME records documented, need to be added to Cloudflare
- **Action Required:** Add 3 CNAME records to Cloudflare DNS:
  - `em.overassessed.ai` → `u60020593.wl094.sendgrid.net`
  - `s1._domainkey.overassessed.ai` → `s1.domainkey.u60020593.wl094.sendgrid.net`
  - `s2._domainkey.overassessed.ai` → `s2.domainkey.u60020593.wl094.sendgrid.net`
- **Important:** All must be DNS-only (grey cloud, proxy OFF)
- **Timeline:** Complete within 2 weeks to allow time for testing
- **Instructions:** See `docs/sendgrid-dns-records.md`
- **Test:** Run `node scripts/test-email.js` after DNS verification

### Google Ads Conversion Tracking
- **Status:** Placeholder conversion labels added to code
- **Action Required:** Tyler needs to:
  1. Log into Google Ads (AW-3513438695)
  2. Go to Tools → Conversions → Create Conversion Action
  3. Create 3 conversion actions:
     - **Form Submit** (pre-reg form, intake form, exemption form)
     - **Phone Call** (click-to-call tracking number)
     - **Pre-Registration Complete** (successful pre-reg completion)
  4. Copy the conversion labels (format: `AW-3513438695/ABC123xyz`)
  5. Replace placeholders in code:
     - `AW-3513438695/FORM_SUBMIT` → real label
     - `AW-3513438695/PHONE_CALL` → real label
     - `AW-3513438695/PRE_REG` → real label
- **Timeline:** Complete 2 weeks before April (to accumulate baseline data)

### Google Business Profile
- **Status:** Not yet created
- **Action Required:**
  1. Create GBP at https://business.google.com
  2. Business name: **OverAssessed**
  3. Category: Property Tax Consultant / Legal Services
  4. Service area: All 15 counties (Bexar, Harris, Dallas, etc.)
  5. Add business phone: (210) 920-1396
  6. Add website: https://overassessed.ai
  7. Upload logo and photos
  8. Add business hours (or 24/7 online service)
  9. Enable messaging
  10. Write business description (200-750 characters)
  11. Add services: Property Tax Protest, Exemption Filing, Tax Appeal
- **Timeline:** Complete by mid-March to allow time for verification
- **Why:** Local SEO for "property tax protest near me" searches

### Google Ads Campaign Build
- **Status:** Tracking installed, campaigns not yet built
- **Action Required:**
  1. Build 15 county-specific campaigns (or 1 campaign with 15 ad groups)
  2. Keywords:
     - Brand: "overassessed", "over assessed texas"
     - Generic: "property tax protest [county]", "reduce property taxes", "fight property tax assessment"
     - Competitor: (optional) other protest companies
  3. Ad copy variations (3-5 per ad group)
  4. Landing page mapping:
     - Main → `/ppc-property-tax-protest.html`
     - Bexar → `/ppc-bexar.html`
     - Harris → `/ppc-harris.html`
     - Dallas → `/ppc-dallas.html`
     - Tarrant → `/ppc-tarrant.html`
     - All other counties → main PPC page with UTM tracking
  5. Budget allocation: TBD (recommend $3k-5k/month April-May)
  6. Bid strategy: Target CPA or Maximize Conversions
  7. Enable call extensions with tracking number
  8. Enable location extensions (once GBP is set up)
- **Timeline:** Build by April 1, launch April 7 (week before notices drop)

### Meta Ads Campaign Build
- **Status:** Pixel installed, campaigns not yet built
- **Action Required:**
  1. Build Facebook + Instagram campaigns
  2. Targeting:
     - Age: 30-65
     - Location: 15 TX counties
     - Interests: Real estate, homeowners, property taxes, investing
     - Lookalike audiences (after collecting 100+ leads)
  3. Ad creative:
     - Static image ads (3-5 variations)
     - Video ads (optional, but higher engagement)
     - Carousel ads showing savings examples
  4. Landing pages: Same as Google Ads
  5. Budget: $2k-3k/month April-May
- **Timeline:** Build by April 1, launch April 7

---

## 🔴 NOT STARTED / NICE TO HAVE

### Email Nurture Automation
- **Status:** Email sequences written, automation not yet built
- **Action Required:**
  1. Set up SendGrid automated email campaigns
  2. Trigger sequences based on:
     - Pre-registration (5-email drip)
     - Post-signup (4-email nurture)
     - Referral nudges (3 emails)
     - Win notifications (1 email)
  3. Build email templates in SendGrid (or use HTML templates)
  4. Set up A/B tests for subject lines
- **Timeline:** Complete by March 31
- **Priority:** High (keeps leads warm until April)

### Referral Program Incentive
- **Status:** Referral page exists, incentive structure unclear
- **Action Required:**
  1. Decide on referral incentive:
     - $50 per successful referral?
     - 10% off next year's service?
     - Amazon gift card?
  2. Update `/referrals.html` with clear incentive
  3. Build referral tracking in Supabase
  4. Create unique referral codes for each user
  5. Build referral dashboard in `/portal.html`
- **Timeline:** Complete by April 15 (post-launch is OK)
- **Priority:** Medium

### Retargeting Campaigns
- **Status:** Not yet built
- **Action Required:**
  1. Build Google Display retargeting campaigns
  2. Build Meta retargeting campaigns
  3. Target users who:
     - Visited landing page but didn't submit form
     - Started form but didn't complete
     - Visited calculator but didn't take action
  4. Creative: "Come back and save $X on your property taxes"
  5. Budget: $500-1k/month
- **Timeline:** Launch April 15 (after initial traffic)
- **Priority:** Medium

### SMS Notifications
- **Status:** Not yet built
- **Action Required:**
  1. Set up Twilio account (or use SendGrid SMS)
  2. Send SMS reminders:
     - "Your property tax notice has arrived — file by May 15"
     - "We filed your protest — here's what happens next"
     - "You won! Your taxes are reduced by $X"
  3. Opt-in during pre-registration
- **Timeline:** April 1
- **Priority:** Low (nice to have, not critical)

### Content Marketing
- **Status:** Not yet started
- **Action Required:**
  1. Write 5-10 blog posts:
     - "How to Protest Your Property Taxes in Texas (2026 Guide)"
     - "Top 15 Counties for Property Tax Protests"
     - "What to Do When Your Property Tax Notice Arrives"
     - "Property Tax Exemptions: Complete Guide for TX Homeowners"
     - "How Much Can You Save on Property Taxes?"
  2. Publish to `/blog/` (if blog exists)
  3. Share on social media
  4. Link from landing pages for SEO
- **Timeline:** March 15-31
- **Priority:** Low (SEO takes time, won't impact April rush)

### Partnership Outreach
- **Status:** Not yet started
- **Action Required:**
  1. Partner with real estate agents (referral fees)
  2. Partner with mortgage brokers (referral fees)
  3. Partner with HOAs (bulk discounts for residents)
  4. Partner with title companies (post-closing tax review)
- **Timeline:** Ongoing (March-May)
- **Priority:** Medium (long-term growth)

---

## 📊 KEY METRICS TO TRACK

Once campaigns launch, monitor:
- **Pre-registrations:** Target 500+ by April 15
- **Lead cost:** Target <$50/lead
- **Conversion rate (landing page):** Target 15-25%
- **Email open rate:** Target 30-40%
- **Show rate (consultation):** Target 50%+
- **Close rate (signed client):** Target 60%+
- **CAC (customer acquisition cost):** Target <$300
- **LTV (lifetime value):** Calculate based on avg savings + referrals

---

## 🚨 CRITICAL PATH (MUST DO BEFORE APRIL)

1. ✅ Landing pages live
2. ✅ Tracking pixels installed
3. 🟡 **Google Search Console setup** (do this week)
4. 🟡 **SendGrid DNS authentication** (do this week)
5. 🟡 **Google Ads conversion labels** (do by March 15)
6. 🟡 **Google Business Profile** (do by March 15)
7. 🟡 **Google Ads campaign build** (do by April 1)
8. 🟡 **Meta Ads campaign build** (do by April 1)
9. 🟡 **Email nurture automation** (do by March 31)
10. 🔴 **Test all forms + conversion tracking** (do by April 5)

---

## NEXT STEPS (Prioritized)

### This Week (March 4-10)
1. Set up Google Search Console (Tyler)
2. Add SendGrid DNS records to Cloudflare (Tyler)
3. Test SendGrid email delivery (`node scripts/test-email.js`)
4. Create Google Ads conversion actions and get labels

### Next Week (March 11-17)
1. Set up Google Business Profile
2. Replace conversion label placeholders in code
3. Build Google Ads campaigns (structure, keywords, ad copy)
4. Build Meta Ads campaigns (targeting, creative)

### Week of March 18-24
1. Set up email nurture automation in SendGrid
2. Test all forms (pre-reg, intake, exemption)
3. Test conversion tracking (submit test leads)
4. Load testing (can system handle 100+ submissions/day?)

### Week of March 25-31
1. Final QA on all landing pages
2. A/B test ad creative
3. Set budgets and bids
4. Write launch announcement email

### Week of April 1-6 (Pre-Launch)
1. Launch Google Ads campaigns (low budget test)
2. Launch Meta Ads campaigns (low budget test)
3. Monitor early results
4. Adjust bids/targeting based on data

### Week of April 7-13 (Notices Start Dropping)
1. Increase ad budgets (notices arriving)
2. Send email blast to pre-registered users
3. Monitor form submissions, conversion rates
4. Respond to leads within 1 hour (high urgency)

### Week of April 14-May 15 (Peak Season)
1. Scale winning campaigns
2. Pause underperforming ad groups
3. Launch retargeting campaigns
4. Send SMS reminders (if built)
5. Monitor daily: leads, CAC, conversion rate

---

## BUDGET ESTIMATE

| Item | Cost | Timeline |
|------|------|----------|
| Google Ads | $3k-5k/month | April-May |
| Meta Ads | $2k-3k/month | April-May |
| Google Business Profile | Free | One-time |
| SendGrid | $20/month | Ongoing |
| Twilio SMS (optional) | $100-200/month | April-May |
| Tracking tools | Free (GTM, GA4, Meta Pixel) | One-time setup |
| **Total Estimated Spend** | **$10k-16k** | April-May |

Expected ROI: If you sign 100 clients at $1,200 avg revenue/client = $120k revenue. Marketing spend = $16k. ROI = 650%.

---

## NOTES

- **Seasonality:** April-May are peak months. Most homeowners receive notices mid-April.
- **Deadline pressure:** May 15 is the hard deadline to file protests. Use urgency in ad copy.
- **Competition:** Other protest companies will also ramp up ads in April. Budget accordingly.
- **Lead quality:** Pre-registration leads are warmer (higher intent) than cold PPC leads.
- **Follow-up speed:** Research shows 80% of leads go with the first company that responds. Aim for <1 hour response time.

---

**Last Updated:** March 4, 2026
**Owner:** Tyler
**Contributors:** Claude (OverAssessed Assistant)
