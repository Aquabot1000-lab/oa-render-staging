# SendGrid Domain Authentication DNS Records

Add these CNAME records to Cloudflare for **overassessed.ai**:

## Required DNS Records

| Type | Name | Target | Proxy Status |
|------|------|--------|--------------|
| CNAME | `em.overassessed.ai` | `u60020593.wl094.sendgrid.net` | DNS only (grey cloud) |
| CNAME | `s1._domainkey.overassessed.ai` | `s1.domainkey.u60020593.wl094.sendgrid.net` | DNS only (grey cloud) |
| CNAME | `s2._domainkey.overassessed.ai` | `s2.domainkey.u60020593.wl094.sendgrid.net` | DNS only (grey cloud) |

## Instructions

1. Log into Cloudflare
2. Select the **overassessed.ai** domain
3. Go to **DNS** → **Records**
4. Add each CNAME record above
5. **IMPORTANT**: Set Proxy status to "DNS only" (grey cloud icon) for all three records
6. Wait 5-10 minutes for DNS propagation
7. Return to SendGrid and click "Verify" on the domain authentication page

## Why DNS Only?

SendGrid's domain authentication requires direct DNS access to validate your domain ownership. Cloudflare's proxy must be disabled for these records.

## Testing

Once verified in SendGrid, you can send test emails from:
- `notifications@overassessed.ai`
- Any other email address at `@overassessed.ai`

Run `node scripts/test-email.js` to test sending.
