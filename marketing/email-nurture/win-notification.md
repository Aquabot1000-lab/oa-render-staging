# Win Notification Email — OverAssessed.ai

> Celebration email sent when a client's protest results in a property value reduction.
> Trigger: Protest outcome = reduction confirmed.
> Goal: Celebrate, explain invoice, drive referrals, opt into annual monitoring.

*Uses the same HTML base template from pre-registration-drip.md.*

---

## Win Notification

**Subject:** 🏆 You won! Your property taxes just dropped by {{SAVINGS_AMOUNT}}/year
**Preview Text:** Your protest was successful — here's exactly how much you're saving.

### HTML Body

```html
<div style="text-align: center; padding: 12px 0 0;">
  <span style="font-size: 64px;">🏆</span>
</div>

<h2 style="text-align: center;">Congratulations, {{FIRST_NAME}}!</h2>

<p style="text-align: center; font-size: 18px;">Your property tax protest was <strong style="color: #27ae60;">successful</strong>.</p>

<div class="stat-block">
  <div class="number">{{SAVINGS_AMOUNT}}</div>
  <div class="label">Annual savings on your property tax bill</div>
</div>

<div style="background: #f9f9f9; border-radius: 10px; padding: 24px; margin: 20px 0;">
  <p style="margin: 0 0 12px; font-weight: 700; font-size: 18px; color: #2d3436;">📋 Your Results Summary</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding: 10px 0; border-bottom: 1px solid #eee;">County's Original Value</td>
      <td style="padding: 10px 0; text-align: right; border-bottom: 1px solid #eee; font-weight: 700;">{{ORIGINAL_VALUE}}</td>
    </tr>
    <tr>
      <td style="padding: 10px 0; border-bottom: 1px solid #eee;">New Appraised Value</td>
      <td style="padding: 10px 0; text-align: right; border-bottom: 1px solid #eee; font-weight: 700; color: #27ae60;">{{NEW_VALUE}}</td>
    </tr>
    <tr>
      <td style="padding: 10px 0; border-bottom: 1px solid #eee;">Value Reduction</td>
      <td style="padding: 10px 0; text-align: right; border-bottom: 1px solid #eee; font-weight: 700; color: #6c5ce7;">{{REDUCTION_AMOUNT}}</td>
    </tr>
    <tr>
      <td style="padding: 10px 0; border-bottom: 1px solid #eee;"><strong>Your Annual Tax Savings</strong></td>
      <td style="padding: 10px 0; text-align: right; border-bottom: 1px solid #eee; font-weight: 800; font-size: 18px; color: #27ae60;">{{SAVINGS_AMOUNT}}</td>
    </tr>
  </table>
</div>

<!-- Invoice Section -->
<div style="background: #fff9e6; border-radius: 10px; padding: 24px; margin: 20px 0; border: 1px solid #f0e6cc;">
  <p style="margin: 0 0 12px; font-weight: 700; font-size: 18px; color: #2d3436;">💳 Your Invoice</p>
  <p style="margin: 0 0 12px;">As agreed, our fee is <strong>20% of your actual tax savings</strong>. You only pay because we won.</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding: 8px 0; border-bottom: 1px solid #f0e6cc;">Annual Tax Savings</td>
      <td style="padding: 8px 0; text-align: right; border-bottom: 1px solid #f0e6cc;">{{SAVINGS_AMOUNT}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; border-bottom: 1px solid #f0e6cc;">Our Fee (20%)</td>
      <td style="padding: 8px 0; text-align: right; border-bottom: 1px solid #f0e6cc; font-weight: 700;">{{FEE_AMOUNT}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0;"><strong>You Keep</strong></td>
      <td style="padding: 8px 0; text-align: right; font-weight: 800; color: #27ae60; font-size: 18px;">{{NET_SAVINGS}}</td>
    </tr>
  </table>
  <p style="margin: 12px 0 0; font-size: 13px; color: #999;">Invoice #{{INVOICE_NUMBER}} · Due within 30 days · <a href="{{INVOICE_LINK}}" style="color: #6c5ce7;">View &amp; pay online</a></p>
</div>

<p style="text-align: center;">
  <a href="{{INVOICE_LINK}}" class="btn">Pay Invoice →</a>
</p>

<!-- Referral CTA -->
<div style="background: linear-gradient(135deg, #6c5ce7, #0984e3); border-radius: 10px; padding: 28px; margin: 28px 0; text-align: center;">
  <p style="margin: 0 0 8px; font-size: 20px; font-weight: 700; color: #ffffff;">Know someone overpaying?</p>
  <p style="margin: 0 0 16px; color: rgba(255,255,255,0.9);">Share OverAssessed.ai and earn <strong>$50</strong> for every friend who signs up.</p>
  <a href="{{REFERRAL_LINK}}" style="display: inline-block; background: #ffffff; color: #6c5ce7 !important; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 700; font-size: 15px;">Share & Earn $50 →</a>
</div>

<!-- Annual Monitoring -->
<div class="highlight-box">
  <strong>🔄 Want us to protest automatically every year?</strong>
  <p style="margin: 8px 0 0;">Opt into <strong>Annual Monitoring</strong> and we'll watch your property value each year. If it goes up, we automatically file a protest — so you never overpay again.</p>
  <p style="margin: 12px 0 0;">
    <a href="https://overassessed.ai/dashboard/annual-monitoring" style="color: #6c5ce7; font-weight: 700; text-decoration: none;">Enable Annual Monitoring →</a>
  </p>
</div>

<p>Thank you for trusting OverAssessed.ai with your property taxes. We're here every year to make sure you pay only what's fair.</p>

<p><strong>Real Experts. Real Results. Guaranteed.</strong></p>

<p>— The OverAssessed.ai Team</p>
```

### Plain Text Fallback

```
🏆 CONGRATULATIONS, {{FIRST_NAME}}!

Your property tax protest was SUCCESSFUL!

YOUR RESULTS:
County's Original Value: {{ORIGINAL_VALUE}}
New Appraised Value: {{NEW_VALUE}}
Value Reduction: {{REDUCTION_AMOUNT}}
Your Annual Tax Savings: {{SAVINGS_AMOUNT}}

YOUR INVOICE:
Annual Tax Savings: {{SAVINGS_AMOUNT}}
Our Fee (20%): {{FEE_AMOUNT}}
You Keep: {{NET_SAVINGS}}

Invoice #{{INVOICE_NUMBER}} · View & pay: {{INVOICE_LINK}}

---

KNOW SOMEONE OVERPAYING?
Share OverAssessed.ai and earn $50 for every friend who signs up.
Your referral link: {{REFERRAL_LINK}}

---

WANT AUTOMATIC PROTESTS EVERY YEAR?
Enable Annual Monitoring and we'll watch your property value. If it goes up, we automatically file.
Enable: https://overassessed.ai/dashboard/annual-monitoring

---

Thank you for trusting OverAssessed.ai.
Real Experts. Real Results. Guaranteed.

— The OverAssessed.ai Team
Unsubscribe: {{UNSUBSCRIBE_URL}}
```
