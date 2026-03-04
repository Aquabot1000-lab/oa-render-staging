# Google Ads Conversion Tracking Setup

**Google Ads Account ID:** AW-3513438695

## Current Status

✅ Google Ads gtag.js installed on all pages
✅ Conversion event placeholders added to key pages
🟡 Conversion labels need to be created in Google Ads account

## Conversion Events Implemented

### 1. Form Submission (Placeholder: `AW-3513438695/FORM_SUBMIT`)
**Pages with this event:**
- `/exemptions.html` - Exemption intake form
- `/ppc-property-tax-protest.html` - PPC landing page form
- `/ppc-bexar.html` - Bexar County PPC form
- `/ppc-harris.html` - Harris County PPC form
- `/ppc-dallas.html` - Dallas County PPC form
- `/ppc-tarrant.html` - Tarrant County PPC form

**Triggers when:** User successfully submits a form and sees success message.

**Implementation:**
```javascript
if (typeof gtag === 'function') {
    gtag('event', 'conversion', {
        'send_to': 'AW-3513438695/FORM_SUBMIT'
    });
}
```

### 2. Pre-Registration (Placeholder: `AW-3513438695/PRE_REG`)
**Pages with this event:**
- `/pre-register.html` - Pre-registration form

**Triggers when:** User successfully pre-registers for the 2026 protest season.

**Implementation:**
```javascript
if (typeof gtag === 'function') {
    gtag('event', 'conversion', {
        'send_to': 'AW-3513438695/PRE_REG'
    });
}
```

### 3. Phone Call (Placeholder: `AW-3513438695/PHONE_CALL`)
**Status:** Not yet implemented (no click-to-call links on current pages)

**To implement:**
1. Add phone number links: `<a href="tel:+12109201396">Call Now</a>`
2. Add onclick tracking:
```javascript
<a href="tel:+12109201396" onclick="gtag('event', 'conversion', {'send_to': 'AW-3513438695/PHONE_CALL'}); return true;">
    Call (210) 920-1396
</a>
```

## Next Steps for Tyler

### Step 1: Create Conversion Actions in Google Ads

1. Log into Google Ads account (AW-3513438695)
2. Go to **Tools & Settings** → **Measurement** → **Conversions**
3. Click **+ New Conversion Action**
4. Create 3 conversion actions:

#### Conversion 1: Form Submission
- **Goal:** Submit lead form
- **Category:** Submit lead form
- **Value:** Use same value for each conversion (recommended: $100)
- **Count:** One (count only one conversion per click)
- **Conversion window:** 30 days
- **View-through conversion window:** 1 day
- **Attribution model:** Data-driven (or Last click)

#### Conversion 2: Pre-Registration
- **Goal:** Submit lead form
- **Category:** Submit lead form
- **Value:** Use same value for each conversion (recommended: $50)
- **Count:** One
- **Conversion window:** 30 days
- **View-through conversion window:** 1 day
- **Attribution model:** Data-driven (or Last click)

#### Conversion 3: Phone Call (Optional)
- **Goal:** Phone calls
- **Category:** Phone calls
- **Value:** Use same value for each conversion (recommended: $150)
- **Count:** One
- **Conversion window:** 30 days

### Step 2: Copy Conversion Labels

After creating each conversion action, Google Ads will show you the conversion tag. It will look like:

```html
gtag('event', 'conversion', {'send_to': 'AW-3513438695/AbCdEfGhIj12345'});
```

Copy the part after the `/` (e.g., `AbCdEfGhIj12345`). This is your conversion label.

### Step 3: Replace Placeholders in Code

Find and replace these placeholders in the codebase:

| Placeholder | Replace With | File(s) |
|-------------|--------------|---------|
| `AW-3513438695/FORM_SUBMIT` | `AW-3513438695/YOUR_FORM_LABEL` | exemptions.html, ppc-*.html (6 files) |
| `AW-3513438695/PRE_REG` | `AW-3513438695/YOUR_PREREG_LABEL` | pre-register.html |
| `AW-3513438695/PHONE_CALL` | `AW-3513438695/YOUR_PHONE_LABEL` | (add to pages with phone links) |

#### Easy Way (VSCode):
1. Open project in VSCode
2. Press `Cmd+Shift+F` (Find in Files)
3. Search for: `AW-3513438695/FORM_SUBMIT`
4. Replace with: `AW-3513438695/AbCdEfGhIj12345` (your real label)
5. Click "Replace All"
6. Repeat for `PRE_REG` and `PHONE_CALL`

#### Command Line Way:
```bash
cd /Users/aquabot/Documents/OverAssessed

# Replace FORM_SUBMIT placeholder
find . -name "*.html" -type f -exec sed -i '' 's/AW-3513438695\/FORM_SUBMIT/AW-3513438695\/YOUR_REAL_LABEL/g' {} +

# Replace PRE_REG placeholder
find . -name "*.html" -type f -exec sed -i '' 's/AW-3513438695\/PRE_REG/AW-3513438695\/YOUR_REAL_LABEL/g' {} +

# Replace PHONE_CALL placeholder
find . -name "*.html" -type f -exec sed -i '' 's/AW-3513438695\/PHONE_CALL/AW-3513438695\/YOUR_REAL_LABEL/g' {} +
```

### Step 4: Test Conversion Tracking

1. Submit a test lead on each page:
   - https://overassessed.ai/pre-register
   - https://overassessed.ai/ppc-property-tax-protest.html
   - https://overassessed.ai/exemptions
2. Wait 2-3 hours
3. Check Google Ads → Conversions to see if test conversions appear
4. If conversions don't appear, check:
   - Browser console for errors (F12 → Console)
   - Google Tag Assistant Chrome extension
   - Google Ads conversion tag troubleshooting guide

### Step 5: Set Conversion Goals in Campaigns

Once conversions are tracking:
1. Go to each Google Ads campaign
2. Settings → Conversions
3. Select which conversions to optimize for
4. Recommended: Include all 3 (Form Submit, Pre-Reg, Phone Call)
5. Set "Conversion goal" to "Account-wide" or "Campaign-specific"

## Tracking Other Events (Optional)

You can also track other user actions for optimization:

### Calculator Usage
```javascript
gtag('event', 'calculator_use', {
    'event_category': 'engagement',
    'event_label': 'property_tax_calculator',
    'value': 1
});
```

### Button Clicks
```javascript
gtag('event', 'cta_click', {
    'event_category': 'engagement',
    'event_label': 'get_started_button',
    'value': 1
});
```

### Page Scroll Depth
```javascript
gtag('event', 'scroll', {
    'event_category': 'engagement',
    'event_label': '75_percent',
    'value': 75
});
```

These won't be "conversions" but will help you understand user behavior.

## Troubleshooting

### Conversions not showing up?
1. Check that gtag.js is loaded (view source, search for `AW-3513438695`)
2. Check browser console for errors (F12 → Console)
3. Install Google Tag Assistant Chrome extension to debug
4. Verify conversion labels match exactly (case-sensitive)
5. Wait 2-3 hours for data to appear in Google Ads

### Getting "Unverified conversion" warning?
- This is normal for the first 7 days
- Google needs to collect data before marking as "verified"
- Conversions will still track, just with a warning

### Too many test conversions?
- Delete test conversions in Google Ads
- Use Google Ads Preview Tool to test ads without triggering conversions

## Resources

- [Google Ads Conversion Tracking Guide](https://support.google.com/google-ads/answer/1722022)
- [Conversion Tracking Best Practices](https://support.google.com/google-ads/answer/6331314)
- [gtag.js Reference](https://developers.google.com/tag-platform/gtagjs/reference)

---

**Last Updated:** March 4, 2026
**Status:** Placeholders in place, awaiting real conversion labels from Google Ads account
