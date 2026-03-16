# Referral Nudge Sequence — OverAssessed

> 3-email sequence to drive referrals.
> Goal: Turn clients into advocates. $50 referral bonus per successful signup.

*Uses the same HTML base template from pre-registration-drip.md.*

---

## Email 1 — After Filing: Share and Earn

**Trigger:** 2 days after protest is filed
**Subject:** Know someone overpaying on property taxes? Earn $50 🎁
**Preview Text:** Share OverAssessed with a friend — you both win.

### HTML Body

```html
<h2>Know someone who's overpaying? 🏠</h2>

<p>{{FIRST_NAME}}, now that your protest is filed and working, we have a question:</p>

<p><strong>Do you know anyone else who might be overpaying on their property taxes?</strong></p>

<p>Spoiler: you probably do. The average Texas homeowner overpays by $1,200/year — and most don't even know it.</p>

<div class="stat-block">
  <div class="number">$50</div>
  <div class="label">For every friend who signs up through your link</div>
</div>

<p><strong>Here's how it works:</strong></p>

<ol>
  <li>Share your personal referral link (below)</li>
  <li>Your friend signs up for a free property analysis</li>
  <li>When they become a client, you get <strong>$50 cash</strong></li>
  <li>There's no limit — refer 10 friends, earn $500</li>
</ol>

<p style="text-align: center;">
  <a href="{{REFERRAL_LINK}}" class="btn">Share Your Referral Link →</a>
</p>

<div style="background: #f9f9f9; border-radius: 10px; padding: 16px 20px; margin: 20px 0; text-align: center;">
  <p style="margin: 0 0 8px; font-size: 13px; color: #999;">Your personal referral link:</p>
  <p style="margin: 0; font-size: 15px; font-weight: 700; color: #6c5ce7; word-break: break-all;">{{REFERRAL_LINK}}</p>
</div>

<p>Think about your neighbors, friends, and family who own property in Texas. They could be leaving thousands on the table every year.</p>

<p>— The OverAssessed Team</p>
```

### Plain Text Fallback

```
KNOW SOMEONE WHO'S OVERPAYING?

{{FIRST_NAME}}, now that your protest is filed, do you know anyone else overpaying on property taxes?

The average Texas homeowner overpays $1,200/year.

EARN $50 FOR EVERY FRIEND WHO SIGNS UP:
1. Share your personal referral link
2. Your friend signs up for a free property analysis
3. When they become a client, you get $50 cash
4. No limit — refer 10 friends, earn $500

Your referral link: {{REFERRAL_LINK}}

Think about neighbors, friends, and family who own property in Texas.

— The OverAssessed Team
Real Experts. Real Results. Guaranteed.
Unsubscribe: {{UNSUBSCRIBE_URL}}
```

---

## Email 2 — Your Neighbors Could Save Too

**Trigger:** 14 days after Email 1
**Subject:** Your neighbors could save thousands on property taxes too
**Preview Text:** Same neighborhood, same overassessment problem. Help them out (and earn $50).

### HTML Body

```html
<h2>Your neighbors could save too 🏘️</h2>

<p>{{FIRST_NAME}}, here's something interesting about property tax assessments:</p>

<p><strong>If your home is overassessed, your neighbors' homes probably are too.</strong></p>

<p>Appraisal districts use mass valuation methods — meaning they often overvalue entire neighborhoods at once. The same data errors and market assumptions that affect your property likely affect the houses around you.</p>

<div class="highlight-box">
  <strong>🏘️ Fun fact:</strong>
  <p style="margin: 8px 0 0;">In neighborhoods where one homeowner successfully protests, nearby homes are often overassessed by similar amounts. Your neighbors could be sitting on hundreds or thousands in savings — and not even know it.</p>
</div>

<p><strong>You'd be doing them a real favor</strong> by sharing OverAssessed. And you earn $50 for each one who signs up.</p>

<div style="margin: 24px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="12">
    <tr>
      <td align="center" style="background: #f0edff; border-radius: 10px; padding: 20px;">
        <p style="margin: 0 0 4px; font-size: 28px;">📱</p>
        <p style="margin: 0; font-weight: 700; font-size: 14px;">Text a neighbor</p>
      </td>
      <td align="center" style="background: #f0edff; border-radius: 10px; padding: 20px;">
        <p style="margin: 0 0 4px; font-size: 28px;">📧</p>
        <p style="margin: 0; font-weight: 700; font-size: 14px;">Forward this email</p>
      </td>
      <td align="center" style="background: #f0edff; border-radius: 10px; padding: 20px;">
        <p style="margin: 0 0 4px; font-size: 28px;">💬</p>
        <p style="margin: 0; font-weight: 700; font-size: 14px;">Share on Nextdoor</p>
      </td>
    </tr>
  </table>
</div>

<p style="text-align: center;">
  <a href="{{REFERRAL_LINK}}" class="btn">Share Your Link ($50/referral) →</a>
</p>

<p>— The OverAssessed Team</p>
```

### Plain Text Fallback

```
YOUR NEIGHBORS COULD SAVE TOO

{{FIRST_NAME}}, if your home is overassessed, your neighbors' homes probably are too.

Appraisal districts use mass valuation — they often overvalue entire neighborhoods at once.

You'd be doing them a real favor by sharing OverAssessed. And you earn $50 for each signup.

EASY WAYS TO SHARE:
- Text a neighbor
- Forward this email
- Share on Nextdoor

Your referral link: {{REFERRAL_LINK}}

— The OverAssessed Team
Real Experts. Real Results. Guaranteed.
Unsubscribe: {{UNSUBSCRIBE_URL}}
```

---

## Email 3 — After Win: You Saved $X!

**Trigger:** After client wins their protest (reduction confirmed)
**Subject:** You saved {{SAVINGS_AMOUNT}}! Help your friends save too 🎉
**Preview Text:** Your protest was successful — now help your friends keep more money too.

### HTML Body

```html
<h2>You saved {{SAVINGS_AMOUNT}}, {{FIRST_NAME}}! 🎉</h2>

<p>Your property tax protest was a success — and that's real money back in your pocket every year.</p>

<div class="stat-block">
  <div class="number">{{SAVINGS_AMOUNT}}</div>
  <div class="label">Your annual property tax savings</div>
</div>

<p>Now imagine if your friends and neighbors could save that kind of money too.</p>

<p><strong>Most of them probably can.</strong> They just don't know it yet.</p>

<div style="background: #f0edff; border-radius: 10px; padding: 24px; margin: 20px 0;">
  <p style="margin: 0 0 12px; font-size: 18px; font-weight: 700; color: #6c5ce7; text-align: center;">Here's a message you can copy & send:</p>
  <div style="background: #fff; border-radius: 8px; padding: 16px; font-style: italic; color: #555;">
    "Hey! I just saved {{SAVINGS_AMOUNT}}/year on my property taxes using OverAssessed. They handled everything — totally free unless they win. You should check it out: {{REFERRAL_LINK}}"
  </div>
</div>

<p><strong>Remember:</strong> You earn <strong>$50</strong> for every friend who signs up through your link. No limit.</p>

<p style="text-align: center;">
  <a href="{{REFERRAL_LINK}}" class="btn">Share & Earn $50 →</a>
</p>

<p>Thank you for trusting OverAssessed. We're proud to have saved you money.</p>

<p>— The OverAssessed Team</p>
```

### Plain Text Fallback

```
YOU SAVED {{SAVINGS_AMOUNT}}, {{FIRST_NAME}}! 🎉

Your property tax protest was a success — real money back in your pocket every year.

Now imagine if your friends and neighbors could save too. Most of them probably can.

COPY & SEND THIS TO A FRIEND:
"Hey! I just saved {{SAVINGS_AMOUNT}}/year on my property taxes using OverAssessed. They handled everything — totally free unless they win. Check it out: {{REFERRAL_LINK}}"

You earn $50 for every friend who signs up. No limit.

Your referral link: {{REFERRAL_LINK}}

— The OverAssessed Team
Real Experts. Real Results. Guaranteed.
Unsubscribe: {{UNSUBSCRIBE_URL}}
```
