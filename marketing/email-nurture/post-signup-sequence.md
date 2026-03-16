# Post-Signup Sequence — OverAssessed

> 4-email sequence after a client completes full signup.
> Trigger: Client signs agreement and provides property details.
> Goal: Guide them through the process, build confidence, reduce support tickets.

*Uses the same HTML base template from pre-registration-drip.md. Only `{{EMAIL_BODY}}` content shown below.*

---

## Email 1 — Welcome + Next Steps + Document Checklist

**Trigger:** Immediately after signup
**Subject:** Welcome aboard! Here's your next step (takes 5 minutes)
**Preview Text:** Your protest is in motion. One quick thing to maximize your savings.

### HTML Body

```html
<h2>You're officially signed up, {{FIRST_NAME}}! 🎉</h2>

<p>We're thrilled to have you. Your property tax protest is now in motion — and we're going to fight for every dollar.</p>

<p>Here's a quick overview of what happens from here:</p>

<div style="margin: 24px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td width="48" valign="top" style="padding-right: 12px;">
        <div style="width: 40px; height: 40px; background: #6c5ce7; border-radius: 50%; color: #fff; text-align: center; line-height: 40px; font-weight: 700;">✓</div>
      </td>
      <td style="padding-bottom: 16px;">
        <strong>You signed up</strong> — Done! ✅
      </td>
    </tr>
    <tr>
      <td width="48" valign="top" style="padding-right: 12px;">
        <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #6c5ce7, #0984e3); border-radius: 50%; color: #fff; text-align: center; line-height: 40px; font-weight: 700;">2</div>
      </td>
      <td style="padding-bottom: 16px;">
        <strong>Submit supporting documents</strong> — Photos, repair receipts, anything that helps your case
      </td>
    </tr>
    <tr>
      <td width="48" valign="top" style="padding-right: 12px;">
        <div style="width: 40px; height: 40px; background: #ddd; border-radius: 50%; color: #666; text-align: center; line-height: 40px; font-weight: 700;">3</div>
      </td>
      <td style="padding-bottom: 16px;">
        <strong>We build your evidence packet</strong> — data-driven analysis + expert review
      </td>
    </tr>
    <tr>
      <td width="48" valign="top" style="padding-right: 12px;">
        <div style="width: 40px; height: 40px; background: #ddd; border-radius: 50%; color: #666; text-align: center; line-height: 40px; font-weight: 700;">4</div>
      </td>
      <td>
        <strong>We file & represent you</strong> — You sit back, we handle the rest
      </td>
    </tr>
  </table>
</div>

<div class="highlight-box">
  <strong>📋 Document Checklist (optional but powerful):</strong>
  <p style="margin: 8px 0 0;">The more we know, the stronger your case. Upload any of these through your dashboard:</p>
  <ul style="margin: 8px 0 0; padding-left: 20px;">
    <li>📸 Photos of any property damage, wear, or needed repairs</li>
    <li>🧾 Receipts for major repairs or maintenance issues</li>
    <li>📄 Recent inspection reports or appraisals</li>
    <li>🏠 Your Notice of Appraised Value (when it arrives)</li>
    <li>📝 Any notes about issues affecting your property's value</li>
  </ul>
</div>

<p style="text-align: center;">
  <a href="https://overassessed.ai/dashboard/documents" class="btn">Upload Documents →</a>
</p>

<p><strong>Don't have any documents?</strong> That's perfectly fine. We'll still build a strong case using public records, comparable sales, and market data. Documents just make it even stronger.</p>

<p>— The OverAssessed Team</p>
```

### Plain Text Fallback

```
YOU'RE OFFICIALLY SIGNED UP, {{FIRST_NAME}}!

Your property tax protest is now in motion.

WHAT HAPPENS NEXT:
1. You signed up — Done! ✓
2. Submit supporting documents (optional but helpful)
3. We build your evidence packet
4. We file & represent you

DOCUMENT CHECKLIST (optional):
- Photos of property damage, wear, or needed repairs
- Receipts for major repairs or maintenance issues
- Recent inspection reports or appraisals
- Your Notice of Appraised Value (when it arrives)
- Notes about issues affecting your property's value

Upload Documents: https://overassessed.ai/dashboard/documents

Don't have documents? That's fine — we'll build a strong case with public records and market data.

— The OverAssessed Team
Real Experts. Real Results. Guaranteed.
Unsubscribe: {{UNSUBSCRIBE_URL}}
```

---

## Email 2 — Documents Received / Analysis in Progress

**Trigger:** After documents are uploaded OR 5 days after signup (whichever comes first)
**Subject:** We're analyzing your property — here's what we're finding
**Preview Text:** Our team is reviewing your property data right now.

### HTML Body

```html
<h2>Analysis in progress 🔍</h2>

<p>{{FIRST_NAME}}, we wanted to let you know — our team is actively working on your property.</p>

<p>Here's what's happening behind the scenes:</p>

<div style="margin: 20px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #eee;">
        <span style="color: #27ae60; font-weight: 700;">✅</span>&nbsp;&nbsp;Pulling county appraisal data for your property
      </td>
    </tr>
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #eee;">
        <span style="color: #27ae60; font-weight: 700;">✅</span>&nbsp;&nbsp;Analyzing comparable property sales in your area
      </td>
    </tr>
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #eee;">
        <span style="color: #f39c12; font-weight: 700;">⏳</span>&nbsp;&nbsp;Running AI valuation model against your property
      </td>
    </tr>
    <tr>
      <td style="padding: 12px 0; border-bottom: 1px solid #eee;">
        <span style="color: #bbb; font-weight: 700;">○</span>&nbsp;&nbsp;Expert review of findings
      </td>
    </tr>
    <tr>
      <td style="padding: 12px 0;">
        <span style="color: #bbb; font-weight: 700;">○</span>&nbsp;&nbsp;Building your evidence packet
      </td>
    </tr>
  </table>
</div>

<div class="highlight-box">
  <strong>💡 What we look for:</strong>
  <ul style="margin: 8px 0 0; padding-left: 20px;">
    <li>Properties similar to yours that sold for less than your appraised value</li>
    <li>Errors in the county's property description (wrong sq ft, lot size, etc.)</li>
    <li>Unequal appraisal — similar homes assessed at lower values</li>
    <li>Market trends that support a lower value</li>
  </ul>
</div>

<p>We'll notify you as soon as your evidence packet is ready. In the meantime, you don't need to do anything.</p>

<p style="text-align: center;">
  <a href="https://overassessed.ai/dashboard" class="btn">Check Your Status →</a>
</p>

<p>— The OverAssessed Team</p>
```

### Plain Text Fallback

```
ANALYSIS IN PROGRESS

{{FIRST_NAME}}, our team is actively working on your property.

WHAT'S HAPPENING:
✅ Pulling county appraisal data for your property
✅ Analyzing comparable property sales in your area
⏳ Running AI valuation model against your property
○ Expert review of findings
○ Building your evidence packet

WHAT WE LOOK FOR:
- Properties similar to yours that sold for less than appraised value
- Errors in the county's property description
- Unequal appraisal — similar homes assessed lower
- Market trends that support a lower value

We'll notify you when your evidence packet is ready.

Check Your Status: https://overassessed.ai/dashboard

— The OverAssessed Team
Real Experts. Real Results. Guaranteed.
Unsubscribe: {{UNSUBSCRIBE_URL}}
```

---

## Email 3 — Evidence Packet Ready

**Trigger:** When evidence packet is compiled
**Subject:** Your evidence packet is ready — here's what we found 📊
**Preview Text:** We found strong arguments for reducing your property value.

### HTML Body

```html
<h2>Your evidence packet is ready, {{FIRST_NAME}} 📊</h2>

<p>Great news — our analysis is complete, and we've built a strong case for your property.</p>

<div class="stat-block">
  <div class="number">{{POTENTIAL_SAVINGS}}</div>
  <div class="label">Estimated potential savings on your tax bill</div>
</div>

<p><strong>Here's a summary of what we found:</strong></p>

<div style="background: #f9f9f9; border-radius: 10px; padding: 20px; margin: 20px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding: 8px 0;"><strong>County's Proposed Value:</strong></td>
      <td style="padding: 8px 0; text-align: right;">{{COUNTY_VALUE}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; border-top: 1px solid #eee;"><strong>Our Estimated Fair Value:</strong></td>
      <td style="padding: 8px 0; text-align: right; border-top: 1px solid #eee; color: #27ae60; font-weight: 700;">{{OUR_VALUE}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; border-top: 1px solid #eee;"><strong>Potential Reduction:</strong></td>
      <td style="padding: 8px 0; text-align: right; border-top: 1px solid #eee; color: #6c5ce7; font-weight: 700;">{{REDUCTION_AMOUNT}}</td>
    </tr>
  </table>
</div>

<div class="highlight-box">
  <strong>📋 Your evidence packet includes:</strong>
  <ul style="margin: 8px 0 0; padding-left: 20px;">
    <li>{{NUM_COMPS}} comparable property sales analysis</li>
    <li>Equity analysis against similarly appraised homes</li>
    <li>Market condition adjustments</li>
    <li>Property-specific factors (from your documents and public records)</li>
  </ul>
</div>

<p>You can review the full evidence packet in your dashboard. <strong>No action is needed from you</strong> — we'll use this to negotiate with the appraisal district.</p>

<p style="text-align: center;">
  <a href="https://overassessed.ai/dashboard/evidence" class="btn">View Your Evidence Packet →</a>
</p>

<p><strong>Next step:</strong> We'll file your protest and schedule the hearing. You'll get an update when it's done.</p>

<p>— The OverAssessed Team</p>
```

### Plain Text Fallback

```
YOUR EVIDENCE PACKET IS READY, {{FIRST_NAME}}

Great news — our analysis is complete and we've built a strong case.

ESTIMATED POTENTIAL SAVINGS: {{POTENTIAL_SAVINGS}}

SUMMARY:
County's Proposed Value: {{COUNTY_VALUE}}
Our Estimated Fair Value: {{OUR_VALUE}}
Potential Reduction: {{REDUCTION_AMOUNT}}

YOUR EVIDENCE INCLUDES:
- {{NUM_COMPS}} comparable property sales analysis
- Equity analysis against similarly appraised homes
- Market condition adjustments
- Property-specific factors

No action needed — we'll use this to negotiate with the appraisal district.

View Your Evidence Packet: https://overassessed.ai/dashboard/evidence

NEXT: We'll file your protest and schedule the hearing.

— The OverAssessed Team
Real Experts. Real Results. Guaranteed.
Unsubscribe: {{UNSUBSCRIBE_URL}}
```

---

## Email 4 — Protest Filed

**Trigger:** After protest is filed with the appraisal district
**Subject:** ✅ Your protest is filed — hearing updates coming
**Preview Text:** We've officially filed your property tax protest. Here's what's next.

### HTML Body

```html
<h2>Your protest is officially filed ✅</h2>

<p>{{FIRST_NAME}}, we've submitted your property tax protest to {{COUNTY_NAME}} Appraisal District.</p>

<div style="background: #f0edff; border-radius: 10px; padding: 24px; margin: 20px 0; text-align: center;">
  <p style="margin: 0 0 4px; font-size: 14px; color: #6c5ce7; text-transform: uppercase; font-weight: 700;">Protest Status</p>
  <p style="margin: 0; font-size: 24px; font-weight: 800; color: #2d3436;">Filed & Pending Hearing</p>
  <p style="margin: 8px 0 0; font-size: 14px; color: #666;">Filed on {{FILING_DATE}} · Case #{{CASE_NUMBER}}</p>
</div>

<p><strong>What happens now:</strong></p>

<ol>
  <li><strong>The appraisal district reviews our protest</strong> — They may offer an informal settlement before the hearing</li>
  <li><strong>If needed, we attend the hearing</strong> — Our experts present your evidence packet to the Appraisal Review Board (ARB)</li>
  <li><strong>You get a decision</strong> — Most cases are resolved in one hearing</li>
</ol>

<div class="highlight-box">
  <strong>📅 Timeline:</strong>
  <p style="margin: 8px 0 0;">Hearings typically happen between <strong>May and August</strong>. We'll notify you when your hearing is scheduled and update you on the outcome immediately.</p>
</div>

<p><strong>Do you need to attend the hearing?</strong> Nope. We handle everything. You don't need to take time off work, prepare anything, or even think about it.</p>

<p style="text-align: center;">
  <a href="https://overassessed.ai/dashboard" class="btn">Track Your Protest →</a>
</p>

<p>We'll be in touch with updates. Thanks for trusting us with your property taxes.</p>

<p>— The OverAssessed Team</p>
```

### Plain Text Fallback

```
YOUR PROTEST IS OFFICIALLY FILED

{{FIRST_NAME}}, we've submitted your property tax protest to {{COUNTY_NAME}} Appraisal District.

STATUS: Filed & Pending Hearing
Filed on {{FILING_DATE}} · Case #{{CASE_NUMBER}}

WHAT HAPPENS NOW:
1. The appraisal district reviews our protest (they may offer an informal settlement)
2. If needed, we attend the hearing and present your evidence
3. You get a decision — most cases resolved in one hearing

TIMELINE: Hearings happen May-August. We'll notify you when yours is scheduled.

DO YOU NEED TO ATTEND? Nope. We handle everything.

Track Your Protest: https://overassessed.ai/dashboard

— The OverAssessed Team
Real Experts. Real Results. Guaranteed.
Unsubscribe: {{UNSUBSCRIBE_URL}}
```
