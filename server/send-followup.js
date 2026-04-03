// env loaded via dotenvx
const sgMail = require('@sendgrid/mail');
const fs = require('fs');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const targets = JSON.parse(fs.readFileSync('/tmp/followup-targets.json', 'utf8'));
const stateFile = '/Users/aquabot/.openclaw/workspace/creator-outreach/outreach-state.json';
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

const SUBJECT = 'Most people miss this';
const BODY = `Quick follow-up —

Most creators leave a surprising amount of money on the table simply because they don't track mileage consistently.

We built a simple tool that fixes this automatically.

A few people testing it are already seeing the difference.

Want early access to try it?

— Tyler
Worthey Aquatics / MilePilot
https://testflight.apple.com/join/4r14t4G6`;

async function send() {
  let sent = 0;
  let failed = 0;
  
  for (const email of targets) {
    const stateKey = email + '_seq2';
    if (state.sent && state.sent[stateKey]) {
      console.log(`SKIP (already sent): ${email}`);
      continue;
    }
    
    try {
      await sgMail.send({
        to: email,
        from: { email: 'tyler@overassessed.ai', name: 'Tyler Worthey' },
        replyTo: { email: 'tyler@overassessed.ai', name: 'Tyler Worthey' },
        subject: SUBJECT,
        text: BODY,
        bcc: [
          { email: 'tyler@wortheyaquatics.com' },
          { email: 'aquabot1000@icloud.com' }
        ],
        trackingSettings: {
          openTracking: { enable: true },
          clickTracking: { enable: true }
        }
      });
      
      if (!state.sent) state.sent = {};
      state.sent[stateKey] = { date: new Date().toISOString(), status: 202 };
      sent++;
      console.log(`✅ ${sent}/${targets.length} — ${email}`);
      
      // Rate limit: ~1 per second
      await new Promise(r => setTimeout(r, 1200));
    } catch (err) {
      failed++;
      console.log(`❌ FAILED: ${email} — ${err.message}`);
    }
  }
  
  // Save state
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  
  console.log(`\n=== FOLLOW-UP COMPLETE ===`);
  console.log(`Sent: ${sent}`);
  console.log(`Failed: ${failed}`);
  console.log(`Skipped: ${targets.length - sent - failed}`);
}

send().catch(console.error);
