#!/usr/bin/env node

/**
 * SendGrid Email Test Script
 * Tests email delivery from notifications@overassessed.ai
 */

require('dotenv').config({ path: __dirname + '/../server/.env' });
const sgMail = require('@sendgrid/mail');

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'notifications@overassessed.ai';
const TEST_RECIPIENT = 'aquabot1000@icloud.com';

if (!SENDGRID_API_KEY) {
  console.error('❌ Error: SENDGRID_API_KEY not found in server/.env');
  process.exit(1);
}

sgMail.setApiKey(SENDGRID_API_KEY);

const msg = {
  to: TEST_RECIPIENT,
  from: FROM_EMAIL,
  subject: 'OverAssessed Email Test',
  text: 'If you receive this, SendGrid is working for OverAssessed.ai!',
  html: '<p>If you receive this, <strong>SendGrid is working</strong> for OverAssessed.ai!</p>',
};

console.log('📧 Sending test email...');
console.log(`From: ${FROM_EMAIL}`);
console.log(`To: ${TEST_RECIPIENT}`);
console.log('');

sgMail
  .send(msg)
  .then(() => {
    console.log('✅ Email sent successfully!');
    console.log('');
    console.log('Check your inbox at aquabot1000@icloud.com');
    console.log('If you don\'t see it within 2-3 minutes:');
    console.log('  1. Check your spam folder');
    console.log('  2. Verify SendGrid domain authentication is complete');
    console.log('  3. Check SendGrid activity feed for delivery status');
  })
  .catch((error) => {
    console.error('❌ Error sending email:');
    console.error(error.response ? error.response.body : error);
    console.error('');
    console.error('📋 Next steps:');
    console.error('  1. Add SendGrid DNS records to Cloudflare (see docs/sendgrid-dns-records.md)');
    console.error('  2. Wait 5-10 minutes for DNS propagation');
    console.error('  3. Go to SendGrid → Settings → Sender Authentication → Verify Domain');
    console.error('  4. Run this script again');
    process.exit(1);
  });
