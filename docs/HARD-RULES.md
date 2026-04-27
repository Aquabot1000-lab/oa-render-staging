# OverAssessed — Hard Rules (do not violate)

## Email From-Address Rule (Tyler 2026-04-27)

**ALL OverAssessed business email MUST go from `@overassessed.ai` addresses via SendGrid.**

✅ Correct:
- SendGrid API with `from: 'tyler@overassessed.ai'` or `from: 'info@overassessed.ai'` or `from: 'notifications@overassessed.ai'`
- Domain `overassessed.ai` is DKIM/SPF authenticated in SendGrid → can send from any subaddress

❌ NEVER use:
- `aquabot1000@icloud.com` for any OA customer/county/business email
- Any aqua-personal address for OA work
- Himalaya iCloud account for OA outbound

If sending business email: use the SendGrid `@sendgrid/mail` client. Reply-To always Tyler-branded.

## Violated 2026-04-27 17:09 CDT
First Hunt CAD reply sent from aquabot1000@icloud.com via himalaya. WRONG.
Corrective sent 17:14 CDT from tyler@overassessed.ai via SendGrid. CORRECT.
Lesson: Default to SendGrid+OA domain for any outbound. If the path requires aqua@ address, STOP and ask.
