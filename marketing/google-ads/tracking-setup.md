# OverAssessed — Tracking & Conversion Setup

---

## 1. Google Ads Conversion Tracking

### Conversion Action 1: Form Submission (Primary)

**Setup in Google Ads:**
1. Go to **Tools & Settings → Conversions → + New Conversion Action**
2. Select **Website**
3. Configure:
   - Name: `Form Submission — Free Analysis`
   - Category: **Lead / Submit lead form**
   - Value: $50 (estimated lead value; adjust after data)
   - Count: **One** (per click)
   - Click-through window: 30 days
   - View-through window: 1 day
   - Attribution: Data-driven (or Last click if <300 conversions)

**Implementation:** Use Google Tag Manager (see Section 2)

### Conversion Action 2: Phone Call

**Option A: Google Forwarding Number**
1. Go to **Tools & Settings → Conversions → + New Conversion Action**
2. Select **Phone calls → Calls from ads or website**
3. Configure:
   - Name: `Phone Call — Website`
   - Count calls longer than: **30 seconds**
   - Value: $50
   - Category: Lead

**Option B: Call from Ad Extension**
1. Add Call Extension to campaigns
2. Google auto-tracks calls from ads
3. Set minimum call duration: 30 seconds

### Conversion Action 3: Pre-Registration

1. **Tools & Settings → Conversions → + New Conversion Action**
2. Configure:
   - Name: `Pre-Registration`
   - Category: **Sign-up**
   - Value: $30 (lower than form since earlier in funnel)
   - Count: One
   - Fire on: Thank-you / confirmation page or custom event

---

## 2. Google Tag Manager (GTM) Configuration

### Step 1: Create GTM Account & Container

1. Go to [tagmanager.google.com](https://tagmanager.google.com)
2. Create account: `OverAssessed`
3. Create container: `overassessed.ai` (Web)
4. Install GTM snippet on all pages:

```html
<!-- GTM Head -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-XXXXXXX');</script>

<!-- GTM Body (immediately after <body>) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
```

### Step 2: Google Ads Conversion Linker

1. **Tags → New Tag**
2. Tag type: **Conversion Linker**
3. Trigger: **All Pages**
4. Save & publish

### Step 3: Form Submission Tag

**Trigger (create first):**
1. **Triggers → New → Form Submission**
   - OR custom event if using AJAX forms
   - Trigger name: `Form Submit — Free Analysis`
   - Fire on: Page URL contains `/thank-you` or form submission event

**If using dataLayer push (recommended for SPA/AJAX forms):**
```javascript
// Add to your form submission handler:
window.dataLayer = window.dataLayer || [];
dataLayer.push({
  'event': 'form_submission',
  'form_type': 'free_analysis'
});
```

**Tag:**
1. **Tags → New Tag**
2. Tag type: **Google Ads Conversion Tracking**
3. Conversion ID: `AW-XXXXXXXXX` (from your Google Ads account)
4. Conversion Label: `XXXXXXXXXXX` (from conversion action)
5. Trigger: Form Submit trigger above

### Step 4: Phone Call Click Tag

**Trigger:**
1. **Triggers → New → Click — Just Links**
2. Fire on: Click URL contains `tel:`
3. Name: `Phone Link Click`

**Tag:**
1. Tag type: **Google Ads Conversion Tracking**
2. Use Phone Call conversion ID/label
3. Trigger: Phone Link Click

### Step 5: Pre-Registration Tag

Same pattern as Form Submission — use unique conversion ID/label for the pre-registration action.

**dataLayer push:**
```javascript
dataLayer.push({
  'event': 'pre_registration',
  'form_type': 'pre_register'
});
```

---

## 3. Google Analytics 4 (GA4) Setup

### Install via GTM

1. **Tags → New → Google Analytics: GA4 Configuration**
2. Measurement ID: `G-XXXXXXXXXX`
3. Trigger: All Pages

### Key Events to Track

| Event Name | Trigger | Purpose |
|---|---|---|
| `generate_lead` | Form submission | Primary conversion |
| `phone_call_click` | tel: link click | Phone lead |
| `pre_register` | Pre-reg form submit | Early funnel |
| `page_view` | All pages | Auto-tracked |
| `scroll` | 90% scroll depth | Engagement |
| `cta_click` | CTA button clicks | Engagement |

### Link GA4 to Google Ads

1. GA4 → Admin → Google Ads Links → Link
2. Select your Google Ads account
3. Enable auto-tagging in Google Ads (Settings → Account Settings)

---

## 4. Retargeting Audiences

### Google Ads Remarketing

**Setup in GTM:**
1. **Tags → New → Google Ads Remarketing**
2. Conversion ID: `AW-XXXXXXXXX`
3. Trigger: All Pages

**Audiences to Create (in Google Ads → Audience Manager):**

| Audience | Definition | Duration | Use |
|---|---|---|---|
| All Visitors | Visited any page | 90 days | Broad retargeting |
| Analysis Starters | Visited /analysis but didn't convert | 30 days | High intent |
| Homepage Bouncers | Visited homepage, <30 sec | 14 days | Re-engage |
| Blog Readers | Visited /blog/* pages | 60 days | Content retarget |
| Converters (Exclude) | Completed form/pre-reg | 180 days | Exclude from ads |
| County Pages | Visited /county/* pages | 45 days | County-specific retarget |

### Facebook/Meta Pixel

**Install via GTM:**
1. **Tags → New → Custom HTML**
2. Paste Meta Pixel base code:

```html
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', 'YOUR_PIXEL_ID');
fbq('track', 'PageView');
</script>
```

3. Trigger: All Pages

**Meta Pixel Events (additional tags):**

| Event | Trigger | Meta Event |
|---|---|---|
| Form Submit | form_submission event | `fbq('track', 'Lead')` |
| Pre-Register | pre_registration event | `fbq('track', 'CompleteRegistration')` |
| Phone Click | tel: click | `fbq('track', 'Contact')` |

**Facebook Custom Audiences to Create:**
1. Website visitors — Last 30/60/90 days
2. Analysis page visitors (non-converters) — 30 days
3. Lookalike: Based on converters (1%, 2%, 5%)

---

## 5. UTM Parameter Structure

### Standard UTM Format

```
https://overassessed.ai/?utm_source={source}&utm_medium={medium}&utm_campaign={campaign}&utm_content={content}&utm_term={term}
```

### Google Ads — Auto-Tagging

Enable auto-tagging in Google Ads (recommended). Use manual UTMs as backup:

### UTM Templates by Campaign

**Campaign 1: Brand**
```
utm_source=google&utm_medium=cpc&utm_campaign=brand&utm_content={adgroupid}&utm_term={keyword}
```

**Campaign 2: High-Intent**
```
utm_source=google&utm_medium=cpc&utm_campaign=high-intent&utm_content={adgroupid}&utm_term={keyword}
```

**Campaign 3: County-Specific**
```
utm_source=google&utm_medium=cpc&utm_campaign=county-{county_name}&utm_content={adgroupid}&utm_term={keyword}
```

**Campaign 4: Competitor**
```
utm_source=google&utm_medium=cpc&utm_campaign=competitor&utm_content={adgroupid}&utm_term={keyword}
```

### Google Ads ValueTrack Parameters

Use these in Final URL suffix or tracking template:

```
{lpurl}?utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={adgroupid}&utm_term={keyword}&matchtype={matchtype}&device={device}&loc={loc_physical_ms}
```

### UTM Naming Convention

| Parameter | Convention | Examples |
|---|---|---|
| utm_source | Platform | google, facebook, bing |
| utm_medium | Channel type | cpc, cpm, email, social, organic |
| utm_campaign | Campaign name (lowercase, hyphens) | brand, high-intent, county-harris, competitor |
| utm_content | Ad group or ad variant | protest-service, appeal, ownwell-alt |
| utm_term | Keyword (auto via {keyword}) | property+tax+protest |

---

## 6. Testing & QA Checklist

Before launching campaigns:

- [ ] GTM container published and loading on all pages
- [ ] Conversion Linker tag firing on all pages
- [ ] Form submission conversion firing on thank-you page / form submit
- [ ] Phone call click tracking on tel: links
- [ ] Pre-registration conversion firing correctly
- [ ] GA4 receiving pageview and event data
- [ ] Google Ads linked to GA4
- [ ] Remarketing tag firing (check with Google Tag Assistant)
- [ ] Meta Pixel firing (check with Facebook Pixel Helper extension)
- [ ] UTM parameters passing correctly (check in GA4 Realtime)
- [ ] Auto-tagging enabled in Google Ads
- [ ] Conversion actions showing "Recording" status in Google Ads
- [ ] Test conversions visible in Google Ads (may take 24–48 hours)

### Tools for QA
- **Google Tag Assistant** (Chrome extension) — verify GTM/GA4/Ads tags
- **Facebook Pixel Helper** (Chrome extension) — verify Meta pixel
- **GTM Preview Mode** — debug tags before publishing
- **GA4 Realtime Report** — confirm events flowing
- **Google Ads Conversion Diagnostics** — check tag health

---

## 7. Reporting Dashboard Setup

### Key Metrics to Track Weekly

| Metric | Target | Source |
|---|---|---|
| Cost per Lead (CPL) | <$50 | Google Ads |
| Conversion Rate | >5% | Google Ads |
| Click-Through Rate | >4% | Google Ads |
| Impressions | Growing | Google Ads |
| Quality Score | >6 avg | Google Ads |
| Bounce Rate | <50% | GA4 |
| Avg. Session Duration | >1 min | GA4 |
| Top Converting Keywords | — | Google Ads |
| Top Converting Counties | — | Google Ads + GA4 |
| Retargeting Pool Size | Growing | Google Ads Audiences |
