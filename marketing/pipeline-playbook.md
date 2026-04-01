# OA Lead → Close Pipeline Playbook

## Stage Definitions

### 1. NEW LEAD (auto)
**Trigger:** Form submission, Google Ads lead, Meta lead
**Auto actions:**
- Record in Supabase with `lead_stage: new_lead`
- Extract property data (address, county, assessed value)
- Score lead (0-100) based on property value + state + source
- If score ≥ 70 → set `priority: high`
**→ Next:** Auto-advance to ANALYZED after property lookup

### 2. ANALYZED (auto)
**Trigger:** Property data retrieved successfully
**Auto actions:**
- Pull county assessment data (CAD records)
- Calculate estimated savings (comparable analysis)
- Set `estimated_savings` on client record
- Send welcome email (template: `welcome`)
- Log activity: `email_sent`
**→ Next:** Advance to CONTACTED after welcome email sent

### 3. CONTACTED (auto + manual)
**Trigger:** Welcome email sent
**Auto actions:**
- Schedule full follow-up sequence:
  - Day 0: Welcome email ✅ (already sent)
  - Day 2: Value proposition email
  - Day 5: Social proof email (case studies, savings examples)
  - Day 7: SMS check-in (if phone number available)
  - Day 10: Deadline urgency email
  - Day 14: Last chance email
  - Day 21: Long-term nurture
**→ Next:** Advance to ENGAGED when client replies OR opens 2+ emails

### 4. ENGAGED (semi-auto)
**Trigger:** Client responds, opens multiple emails, or asks questions
**Auto actions:**
- Send fee agreement (20% TX / 25% WA / state-specific)
- Flag for Tyler review if property > $500K
- Escalation alert to AquaBot
**→ Next:** Advance to SIGNED when fee agreement returned

### 5. SIGNED (manual confirm)
**Trigger:** Fee agreement received and confirmed
**Auto actions:**
- Create appeal record in `appeals` table
- Generate case number (OA-XXXX)
- Upload fee agreement to `documents`
- Send confirmation email
- Set `signed_at` timestamp
**→ Next:** Advance to FILED when protest submitted to CAD

### 6. FILED (manual confirm)
**Trigger:** Protest filed with county appraisal district
**Auto actions:**
- Set `filed_at` timestamp
- Begin monitoring CAD portal for status updates
- Send "Your protest has been filed" email
**→ Next:** Advance to CLOSED when result received

### 7. CLOSED (manual confirm)
**Trigger:** Protest result received (win, partial, or loss)
**Auto actions:**
- Record `actual_savings`
- Set `closed_at` timestamp
- If savings > 0: send win notification email
- If savings > $1,000: request Google/Yelp review
- Calculate and record commission
- Add to annual monitoring list

---

## Follow-Up Schedule

| Day | Channel | Template | Purpose |
|-----|---------|----------|---------|
| 0 | Email | welcome | Introduce OA, confirm property info |
| 2 | Email | value_prop | Show estimated savings, explain process |
| 5 | Email | social_proof | Customer testimonials, success rates |
| 7 | SMS | quick_check | "Hi [name], did you see our estimate?" |
| 10 | Email | deadline_urgency | Filing deadlines, urgency |
| 14 | Email | last_chance | Final follow-up before nurture |
| 21 | Email | long_term_nurture | Move to monthly newsletter |

**Rules:**
- If client replies at any point → stop auto-sequence, advance to ENGAGED
- If client unsubscribes → stop all emails, keep in CRM as "opted out"
- High-value leads (>$500K) → Tyler gets notified at Day 5 if no response

---

## Escalation Rules

**Auto-escalate to Tyler (via Telegram) when:**
1. Property assessed value > $500K
2. Estimated savings > $2,000
3. Lead stalled in CONTACTED for 7+ days
4. Lead stalled in ENGAGED for 5+ days
5. Client expresses negative sentiment in reply
6. Client mentions competitor (Ownwell, etc.)

**Escalation format:**
```
🚨 OA ESCALATION: [Client Name]
Stage: [current stage] (X days)
Property: $XXX,XXX assessed
Est. Savings: $X,XXX
Reason: [escalation reason]
Action needed: [recommendation]
```

---

## Lead Scoring (0-100)

| Factor | Points |
|--------|--------|
| Property value > $500K | +30 |
| Property value $300K-$500K | +20 |
| Property value $200K-$300K | +10 |
| TX property (highest volume) | +15 |
| WA property (highest fee %) | +20 |
| GA/CO property | +10 |
| Source: Google Ads | +15 |
| Source: Referral | +20 |
| Source: Organic | +10 |
| Has phone number | +5 |
| Replied to email | +10 |
| Multiple properties | +15 |

**Priority mapping:**
- Score 70-100 → `urgent`
- Score 50-69 → `high`
- Score 30-49 → `normal`
- Score 0-29 → `low`

---

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/pipeline/metrics` | Full funnel metrics + conversion rates |
| POST | `/api/pipeline/advance` | Move client to next stage |
| GET | `/api/pipeline/followups` | Pending follow-ups (for cron) |
| GET | `/api/pipeline/escalations` | Leads needing attention |
| POST | `/api/pipeline/log` | Log any activity |
| GET | `/api/pipeline/activity/:id` | Client activity history |

---

## Conversion Rate Tracking

Available via `/api/pipeline/metrics` and `conversion_funnel` SQL view:

- **Lead → Contact Rate:** % of new leads that get contacted
- **Contact → Engage Rate:** % of contacted leads that respond
- **Engage → Sign Rate:** % of engaged leads that sign
- **Overall Close Rate:** % of all leads that sign

Target benchmarks:
- Contact rate: >95% (automated)
- Engage rate: >30%
- Sign rate: >60%
- Overall close: >18%
