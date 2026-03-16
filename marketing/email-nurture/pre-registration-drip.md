# Pre-Registration Drip Sequence — OverAssessed

> 5-email nurture sequence for pre-registered leads.
> Trigger: User submits email/address on landing page.
> Goal: Keep them engaged until notices arrive, then convert to full signup.

---

## Shared HTML Base Template

All emails use this responsive wrapper. Replace `{{EMAIL_BODY}}` with each email's unique content.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>OverAssessed</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
  body { margin: 0; padding: 0; width: 100% !important; height: 100% !important; background-color: #f4f6f9; }
  .wrapper { width: 100%; table-layout: fixed; background-color: #f4f6f9; padding: 40px 0; }
  .main { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
  .header { background: linear-gradient(135deg, #6c5ce7, #0984e3); padding: 24px 40px; text-align: center; }
  .header h1 { color: #ffffff; font-family: -apple-system, 'SF Pro Display', 'Helvetica Neue', system-ui, sans-serif; font-size: 22px; margin: 0; font-weight: 700; }
  .body-content { padding: 28px 40px 36px; font-family: -apple-system, 'SF Pro Display', 'Helvetica Neue', system-ui, sans-serif; font-size: 16px; line-height: 1.65; color: #1d1d1f; }
  .body-content h2 { color: #6c5ce7; font-size: 20px; margin: 0 0 12px; }
  .body-content p { margin: 0 0 16px; }
  .btn { display: inline-block; background: linear-gradient(135deg, #6c5ce7, #0984e3); color: #ffffff !important; text-decoration: none; padding: 14px 36px; border-radius: 980px; font-weight: 700; font-size: 16px; margin: 8px 0 16px; }
  .highlight-box { background: #f0edff; border-left: 4px solid #6c5ce7; padding: 16px 20px; border-radius: 0 8px 8px 0; margin: 20px 0; }
  .stat-block { text-align: center; padding: 24px; background: linear-gradient(135deg, #6c5ce7, #0984e3); border-radius: 10px; margin: 20px 0; }
  .stat-block .number { font-size: 42px; font-weight: 800; color: #ffffff; line-height: 1.1; }
  .stat-block .label { font-size: 14px; color: rgba(255,255,255,0.85); margin-top: 4px; }
  .footer { padding: 24px 40px; text-align: center; font-family: -apple-system, 'SF Pro Display', 'Helvetica Neue', system-ui, sans-serif; font-size: 12px; color: #999; border-top: 1px solid #eee; }
  .footer a { color: #6c5ce7; text-decoration: none; }
  @media only screen and (max-width: 620px) {
    .main { margin: 0 12px !important; }
    .header, .body-content, .footer { padding-left: 24px !important; padding-right: 24px !important; }
    .stat-block .number { font-size: 32px; }
  }
</style>
</head>
<body>
<div class="wrapper">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <div class="main">
        <div class="header">
          <h1>OverAssessed</h1>
        </div>
        <div class="body-content">
          {{EMAIL_BODY}}
        </div>
        <div class="footer">
          <p><strong>Real Experts. Real Results. Guaranteed.</strong></p>
          <p>OverAssessed — Texas Property Tax Protest</p>
          <p><a href="{{UNSUBSCRIBE_URL}}">Unsubscribe</a> · <a href="https://overassessed.ai/privacy">Privacy Policy</a></p>
        </div>
      </div>
    </td></tr>
  </table>
</div>
</body>
</html>
```

---

## Email 1 — Welcome + What to Expect

**Trigger:** Immediately after pre-registration
**Subject:** You're in! Here's how we'll save you money on property taxes
**Preview Text:** We'll handle everything — here's the timeline.

### HTML Body (`{{EMAIL_BODY}}`)

```html
<h2>Welcome to OverAssessed, {{FIRST_NAME}}! 🎉</h2>

<p>Smart move. You just took the first step toward paying only what you actually owe in property taxes.</p>

<p>Here's what happens next — and the best part? <strong>You don't have to do anything until we tell you.</strong></p>

<div class="highlight-box">
  <strong>📋 Your Timeline:</strong>
  <ul style="margin: 8px 0 0; padding-left: 20px;">
    <li><strong>Mid-April:</strong> Your county mails proposed value notices</li>
    <li><strong>May 15:</strong> Protest filing deadline</li>
    <li><strong>May–August:</strong> Hearings &amp; negotiations</li>
    <li><strong>You save money 💰</strong></li>
  </ul>
</div>

<p><strong>How OverAssessed works:</strong></p>
<ol>
  <li>We monitor your property's proposed value</li>
  <li>We build a custom evidence packet using AI + expert analysis</li>
  <li>We file your protest and handle the hearing</li>
  <li>You only pay <strong>20% of what we save you</strong> — nothing upfront, ever</li>
</ol>

<p>No savings? No charge. That's our guarantee.</p>

<p>We'll email you when it's time to take the next step. Until then, sit tight — we've got this.</p>

<p style="text-align: center;">
  <a href="https://overassessed.ai/dashboard" class="btn">View Your Dashboard →</a>
</p>

<p>Questions? Just reply to this email.</p>

<p>— The OverAssessed Team</p>
```

### Plain Text Fallback

```
Welcome to OverAssessed, {{FIRST_NAME}}!

Smart move. You just took the first step toward paying only what you actually owe in property taxes.

Here's what happens next — and the best part? You don't have to do anything until we tell you.

YOUR TIMELINE:
- Mid-April: Your county mails proposed value notices
- May 15: Protest filing deadline
- May-August: Hearings & negotiations
- You save money!

HOW IT WORKS:
1. We monitor your property's proposed value
2. We build a custom evidence packet using AI + expert analysis
3. We file your protest and handle the hearing
4. You only pay 20% of what we save you — nothing upfront, ever

No savings? No charge. That's our guarantee.

View Your Dashboard: https://overassessed.ai/dashboard

Questions? Just reply to this email.

— The OverAssessed Team
Real Experts. Real Results. Guaranteed.
Unsubscribe: {{UNSUBSCRIBE_URL}}
```

---

## Email 2 — Did You Know?

**Trigger:** 3 days after Email 1
**Subject:** The average Texas homeowner overpays $1,200/year in property taxes
**Preview Text:** That's money you could keep — here's why it happens.

### HTML Body

```html
<h2>Did you know? 🤔</h2>

<div class="stat-block">
  <div class="number">$1,200</div>
  <div class="label">Average annual overpayment by Texas homeowners</div>
</div>

<p>{{FIRST_NAME}}, most Texas homeowners are paying more than they should — and they don't even know it.</p>

<p><strong>Here's why it happens:</strong></p>

<p>County appraisal districts assess <em>millions</em> of properties every year. They use mass appraisal methods — essentially, broad estimates. That means your home's "appraised value" often doesn't reflect reality.</p>

<div class="highlight-box">
  <strong>Common reasons you're overassessed:</strong>
  <ul style="margin: 8px 0 0; padding-left: 20px;">
    <li>Your home has issues the county doesn't know about</li>
    <li>Comparable sales data is outdated or inaccurate</li>
    <li>Market conditions shifted after the appraisal date</li>
    <li>Your neighborhood was lumped with higher-value areas</li>
  </ul>
</div>

<p><strong>The fix?</strong> File a protest. Texas law gives every property owner the right to challenge their assessed value — and <strong>over 50% of protests result in a reduction.</strong></p>

<p>That's where we come in. OverAssessed uses data-driven analysis combined with human expertise to build the strongest possible case for your property.</p>

<p style="text-align: center;">
  <a href="https://overassessed.ai/how-it-works" class="btn">See How We Save You Money →</a>
</p>

<p>Stay tuned — notices are coming soon.</p>

<p>— The OverAssessed Team</p>
```

### Plain Text Fallback

```
DID YOU KNOW?

The average Texas homeowner overpays $1,200/year in property taxes.

{{FIRST_NAME}}, most Texas homeowners are paying more than they should — and they don't even know it.

HERE'S WHY:
County appraisal districts assess millions of properties using mass appraisal methods — broad estimates. Your home's "appraised value" often doesn't reflect reality.

COMMON REASONS YOU'RE OVERASSESSED:
- Your home has issues the county doesn't know about
- Comparable sales data is outdated or inaccurate
- Market conditions shifted after the appraisal date
- Your neighborhood was lumped with higher-value areas

THE FIX: File a protest. Over 50% of protests result in a reduction.

See How We Save You Money: https://overassessed.ai/how-it-works

— The OverAssessed Team
Real Experts. Real Results. Guaranteed.
Unsubscribe: {{UNSUBSCRIBE_URL}}
```

---

## Email 3 — Notices Coming Mid-April

**Trigger:** 7 days after Email 1
**Subject:** Your property tax notice is coming — here's what to look for
**Preview Text:** Notices arrive mid-April. Here's exactly what to do (and not do).

### HTML Body

```html
<h2>Heads up: Notices are almost here 📬</h2>

<p>{{FIRST_NAME}}, appraisal districts across Texas will start mailing <strong>Notice of Appraised Value</strong> letters in mid-April.</p>

<p>This is the single most important document in your property tax year. Here's what you need to know:</p>

<div class="highlight-box">
  <strong>📄 What to look for on your notice:</strong>
  <ul style="margin: 8px 0 0; padding-left: 20px;">
    <li><strong>Proposed Market Value</strong> — what the county thinks your home is worth</li>
    <li><strong>Last Year's Value</strong> — compare to see the increase</li>
    <li><strong>Homestead Cap</strong> — if you have a homestead exemption, taxable value can only rise 10%/year</li>
    <li><strong>Protest Deadline</strong> — usually May 15 or 30 days after notice date</li>
  </ul>
</div>

<p><strong>What NOT to do:</strong></p>
<ul>
  <li>❌ Don't ignore it</li>
  <li>❌ Don't assume the county got it right</li>
  <li>❌ Don't try to file a protest yourself without data</li>
</ul>

<p><strong>What TO do:</strong></p>
<ul>
  <li>✅ Check that your property details are correct (sq ft, bedrooms, etc.)</li>
  <li>✅ Forward your notice to us (or snap a photo — we'll read it)</li>
  <li>✅ Let OverAssessed handle the rest</li>
</ul>

<p>Since you're pre-registered, we're already monitoring your property. When your notice drops, we'll alert you and start building your case immediately.</p>

<p style="text-align: center;">
  <a href="https://overassessed.ai/dashboard" class="btn">Check Your Property Status →</a>
</p>

<p>— The OverAssessed Team</p>
```

### Plain Text Fallback

```
HEADS UP: NOTICES ARE ALMOST HERE

{{FIRST_NAME}}, appraisal districts across Texas will start mailing Notice of Appraised Value letters in mid-April.

WHAT TO LOOK FOR:
- Proposed Market Value — what the county thinks your home is worth
- Last Year's Value — compare to see the increase
- Homestead Cap — taxable value can only rise 10%/year with homestead
- Protest Deadline — usually May 15 or 30 days after notice date

WHAT NOT TO DO:
- Don't ignore it
- Don't assume the county got it right
- Don't try to file yourself without data

WHAT TO DO:
- Check that your property details are correct
- Forward your notice to us (or snap a photo)
- Let OverAssessed handle the rest

Check Your Property Status: https://overassessed.ai/dashboard

— The OverAssessed Team
Real Experts. Real Results. Guaranteed.
Unsubscribe: {{UNSUBSCRIBE_URL}}
```

---

## Email 4 — Social Proof + Early Bird

**Trigger:** 14 days after Email 1
**Subject:** "We saved $4,200 and didn't lift a finger" — here's what our clients say
**Preview Text:** Real results from real Texas homeowners. Plus: your early bird advantage.

### HTML Body

```html
<h2>What our clients are saying 💬</h2>

<p>{{FIRST_NAME}}, don't just take our word for it. Here's what happened for homeowners who used OverAssessed last year:</p>

<div style="background: #f9f9f9; border-radius: 10px; padding: 20px; margin: 20px 0;">
  <p style="font-style: italic; font-size: 17px; margin: 0 0 8px;">"I had no idea my home was overassessed by $38,000. OverAssessed handled everything — I literally just signed up and got a check. Saved $4,200 on my tax bill."</p>
  <p style="margin: 0; font-weight: 700; color: #6c5ce7;">— Maria R., Bexar County</p>
</div>

<div style="background: #f9f9f9; border-radius: 10px; padding: 20px; margin: 20px 0;">
  <p style="font-style: italic; font-size: 17px; margin: 0 0 8px;">"I've protested on my own before and got nowhere. These guys had data I couldn't even find. Reduction in one hearing."</p>
  <p style="margin: 0; font-weight: 700; color: #6c5ce7;">— James T., Travis County</p>
</div>

<div style="background: #f9f9f9; border-radius: 10px; padding: 20px; margin: 20px 0;">
  <p style="font-style: italic; font-size: 17px; margin: 0 0 8px;">"No upfront cost and they only charge if they win? No-brainer. Saved $1,800."</p>
  <p style="margin: 0; font-weight: 700; color: #6c5ce7;">— David &amp; Sarah K., Harris County</p>
</div>

<div class="stat-block">
  <div class="number">87%</div>
  <div class="label">of our clients received a property value reduction last year</div>
</div>

<div class="highlight-box">
  <strong>🎯 Your Early Bird Advantage:</strong>
  <p style="margin: 8px 0 0;">Because you pre-registered, your property is already in our system. The moment notices drop, we start building your case — giving you a head start over homeowners who wait until the last minute.</p>
</div>

<p>Protest season is right around the corner. You're in a great position.</p>

<p style="text-align: center;">
  <a href="https://overassessed.ai/dashboard" class="btn">View Your Property →</a>
</p>

<p>— The OverAssessed Team</p>
```

### Plain Text Fallback

```
WHAT OUR CLIENTS ARE SAYING

"I had no idea my home was overassessed by $38,000. Saved $4,200 on my tax bill."
— Maria R., Bexar County

"I've protested on my own before and got nowhere. Reduction in one hearing."
— James T., Travis County

"No upfront cost and they only charge if they win? No-brainer. Saved $1,800."
— David & Sarah K., Harris County

87% of our clients received a property value reduction last year.

YOUR EARLY BIRD ADVANTAGE:
Because you pre-registered, your property is already in our system. The moment notices drop, we start building your case — giving you a head start.

View Your Property: https://overassessed.ai/dashboard

— The OverAssessed Team
Real Experts. Real Results. Guaranteed.
Unsubscribe: {{UNSUBSCRIBE_URL}}
```

---

## Email 5 — Season Is Here / Auto-Filing

**Trigger:** 21 days after Email 1 (or timed to notice season)
**Subject:** 🚀 It's go time — we're filing your protest automatically
**Preview Text:** Notices are out. We're building your case right now.

### HTML Body

```html
<h2>It's go time, {{FIRST_NAME}} 🚀</h2>

<p>Property tax notices are hitting mailboxes across Texas — and <strong>we're already on it.</strong></p>

<p>Because you pre-registered, here's what's happening right now for your property:</p>

<div style="margin: 24px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td width="48" valign="top" style="padding-right: 12px;">
        <div style="width: 40px; height: 40px; background: #6c5ce7; border-radius: 50%; color: #fff; text-align: center; line-height: 40px; font-weight: 700;">1</div>
      </td>
      <td style="padding-bottom: 16px;">
        <strong>Pulling your proposed value</strong> — We've retrieved your county's appraised value.
      </td>
    </tr>
    <tr>
      <td width="48" valign="top" style="padding-right: 12px;">
        <div style="width: 40px; height: 40px; background: #6c5ce7; border-radius: 50%; color: #fff; text-align: center; line-height: 40px; font-weight: 700;">2</div>
      </td>
      <td style="padding-bottom: 16px;">
        <strong>Building your evidence packet</strong> — expert analysis + comparable sales + market data.
      </td>
    </tr>
    <tr>
      <td width="48" valign="top" style="padding-right: 12px;">
        <div style="width: 40px; height: 40px; background: #0984e3; border-radius: 50%; color: #fff; text-align: center; line-height: 40px; font-weight: 700;">3</div>
      </td>
      <td style="padding-bottom: 16px;">
        <strong>Filing your protest</strong> — We'll submit before the May 15 deadline.
      </td>
    </tr>
    <tr>
      <td width="48" valign="top" style="padding-right: 12px;">
        <div style="width: 40px; height: 40px; background: #0984e3; border-radius: 50%; color: #fff; text-align: center; line-height: 40px; font-weight: 700;">4</div>
      </td>
      <td>
        <strong>Representing you</strong> — We handle hearings, negotiations, and escalation.
      </td>
    </tr>
  </table>
</div>

<div class="highlight-box">
  <strong>⚡ One thing we need from you:</strong>
  <p style="margin: 8px 0 0;">To give us the strongest case, <strong>complete your signup</strong> so we can access your property details and file on your behalf. It takes about 2 minutes.</p>
</div>

<p style="text-align: center;">
  <a href="https://overassessed.ai/signup?ref=drip5" class="btn">Complete Your Signup (2 min) →</a>
</p>

<p><strong>Remember:</strong> You pay nothing upfront. Our fee is 20% of your actual savings. No reduction = no charge.</p>

<p>The deadline is <strong>May 15</strong>. Don't leave money on the table.</p>

<p>— The OverAssessed Team</p>
```

### Plain Text Fallback

```
IT'S GO TIME, {{FIRST_NAME}}!

Property tax notices are hitting mailboxes — and we're already on it.

HERE'S WHAT'S HAPPENING FOR YOUR PROPERTY:
1. Pulling your proposed value from county records
2. Building your evidence packet — AI + comps + market data
3. Filing your protest before the May 15 deadline
4. Representing you at hearings and negotiations

ONE THING WE NEED: Complete your signup so we can file on your behalf. Takes 2 minutes.

Complete Your Signup: https://overassessed.ai/signup?ref=drip5

REMEMBER: You pay nothing upfront. 20% of savings. No reduction = no charge.

Deadline: May 15. Don't leave money on the table.

— The OverAssessed Team
Real Experts. Real Results. Guaranteed.
Unsubscribe: {{UNSUBSCRIBE_URL}}
```
