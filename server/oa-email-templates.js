/**
 * OverAssessed — Outlook-Safe Email Template System
 * 
 * All customer-facing emails use the same branded, table-based layout.
 * Zero CSS classes, zero <style> blocks, zero gradients.
 * VML button fallback for Outlook. Arial font stack.
 * 
 * Usage:
 *   const { wrapEmail } = require('./oa-email-templates');
 *   const html = wrapEmail({ body: '<p>Hello</p>', preheader: 'Preview text' });
 */

const BRAND = {
  purple: '#6c5ce7',
  purpleDark: '#5a4bd6',
  purpleLight: '#f0eeff',
  purpleMid: '#c4bbff',
  green: '#00b894',
  greenLight: '#e6faf4',
  greenMuted: '#b2f0e0',
  bgOuter: '#f4f3f9',
  bgInner: '#ffffff',
  bgFooter: '#f8f7fc',
  bgDisclaimer: '#fafafa',
  bgStatLight: '#f8f7fc',
  textDark: '#1a1a2e',
  textBody: '#4a4a68',
  textMuted: '#7c7c96',
  textFaint: '#a0a0b8',
  textFooter: '#b0b0c4',
  border: '#e8e6f0',
  font: "Arial, Helvetica, sans-serif"
};

function wrapEmail({ body, preheader = '' }) {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>OverAssessed</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<style type="text/css">body, table, td, p, a { font-family: ${BRAND.font}; } table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; } td { padding: 0; }</style>
<![endif]-->
</head>
<body style="margin:0; padding:0; background-color:${BRAND.bgOuter}; font-family:${BRAND.font}; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100;">
<!--[if mso]><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:${BRAND.bgOuter};"><tr><td><![endif]-->
${preheader ? `<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:${BRAND.bgOuter};">${preheader} &#8199;&#65279;&#847; &#8199;&#65279;&#847; &#8199;&#65279;&#847;</div>` : ''}
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:${BRAND.bgOuter};">
<tr><td align="center" style="padding:12px 8px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="width:600px; max-width:600px; background-color:${BRAND.bgInner};">

<!-- HEADER -->
<tr><td style="background-color:${BRAND.purple}; padding:14px 24px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr>
<td style="font-size:18px; font-weight:bold; color:#ffffff; font-family:${BRAND.font};">OVERASSESSED<span style="font-size:10px; font-weight:normal; color:${BRAND.purpleMid}; vertical-align:top;"> LLC</span></td>
<td align="right" style="font-size:11px; color:${BRAND.purpleMid}; font-family:${BRAND.font};">Property Tax Protest Experts</td>
</tr></table>
</td></tr>

<!-- BODY -->
${body}

<!-- FOOTER -->
<tr><td style="background-color:${BRAND.bgFooter}; border-top:1px solid ${BRAND.border}; padding:14px 24px; font-family:${BRAND.font};">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
<tr><td>
<p style="margin:0 0 2px 0; font-size:13px; font-weight:bold; color:${BRAND.textDark};">OverAssessed LLC</p>
<p style="margin:0 0 2px 0; font-size:12px; color:${BRAND.textMuted}; line-height:17px;">6002 Camp Bullis, Suite 208, San Antonio, TX 78257</p>
<p style="margin:0 0 2px 0; font-size:12px; color:${BRAND.textMuted}; line-height:17px;">Phone: <a href="tel:+12107607236" style="color:${BRAND.purple}; text-decoration:none;">210-760-7236</a> &#183; Email: <a href="mailto:tyler@overassessed.ai" style="color:${BRAND.purple}; text-decoration:none;">tyler@overassessed.ai</a></p>
<p style="margin:0; font-size:12px; color:${BRAND.textMuted}; line-height:17px;">Web: <a href="https://overassessed.com" style="color:${BRAND.purple}; text-decoration:none;">overassessed.com</a></p>
</td></tr>
<tr><td style="padding-top:8px;">
<p style="margin:0; font-size:10px; line-height:14px; color:${BRAND.textFooter};">You received this email because you submitted a property for tax analysis with OverAssessed. If you no longer wish to receive these emails, <a href="https://overassessed.ai/unsubscribe" style="color:${BRAND.textMuted}; text-decoration:underline;">unsubscribe here</a>.</p>
</td></tr>
</table>
</td></tr>

</table>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</body>
</html>`;
}

function ctaButton(text, url) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
<td align="center" style="background-color:${BRAND.purple};">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:46px; v-text-anchor:middle; width:280px;" arcsize="50%" strokecolor="${BRAND.purple}" fillcolor="${BRAND.purple}"><w:anchorlock/><center style="color:#ffffff; font-family:${BRAND.font}; font-size:15px; font-weight:bold;">${text}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${url}" target="_blank" style="display:inline-block; padding:13px 40px; font-size:15px; font-weight:bold; color:#ffffff; text-decoration:none; font-family:${BRAND.font};">${text}</a><!--<![endif]-->
</td></tr></table>`;
}

function divider() {
  return `<tr><td style="padding:0 24px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr><td style="border-top:1px solid ${BRAND.border}; font-size:0; line-height:0; height:1px;">&nbsp;</td></tr></table></td></tr>`;
}

// ─────────────────────────────────────────────────
// TEMPLATE 1: Pre-Registration Confirmation
// ─────────────────────────────────────────────────
function preRegistrationEmail({ firstName, propertyAddress, county }) {
  const body = `
<tr><td style="padding:16px 24px 8px 24px; font-family:${BRAND.font};">
  <p style="margin:0; font-size:21px; line-height:26px; font-weight:bold; color:${BRAND.textDark};">You're Registered</p>
  <p style="margin:4px 0 0 0; font-size:14px; line-height:20px; color:${BRAND.textMuted};">Next step when appraisal notices arrive</p>
</td></tr>
<tr><td style="padding:8px 24px 12px 24px; font-family:${BRAND.font};">
  <p style="margin:0 0 12px 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">Hi ${firstName},</p>
  <p style="margin:0 0 12px 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">You're all set &mdash; we've saved your property at <strong>${propertyAddress}</strong> in <strong>${county || 'your'} County</strong>.</p>
  <p style="margin:0 0 12px 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">When appraisal notices are released, we'll reach out right away.</p>
  <p style="margin:0 0 8px 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">At that time, we will need you to upload your appraisal notice so we can:</p>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 12px 0;">
    <tr><td style="padding:2px 0 2px 8px; font-size:14px; color:${BRAND.textBody};">&#8226; verify your assessed value</td></tr>
    <tr><td style="padding:2px 0 2px 8px; font-size:14px; color:${BRAND.textBody};">&#8226; access your property account number</td></tr>
    <tr><td style="padding:2px 0 2px 8px; font-size:14px; color:${BRAND.textBody};">&#8226; build an accurate protest case</td></tr>
  </table>
  <p style="margin:0 0 12px 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">It only takes about 30 seconds, and we'll guide you through it.</p>
  <p style="margin:0 0 0 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">Once submitted, we'll handle everything from there &mdash; including analysis, evidence, and filing.</p>
</td></tr>
<tr><td style="padding:4px 24px 14px 24px; font-family:${BRAND.font};">
  <p style="margin:0; font-size:13px; color:${BRAND.textMuted};">&mdash; OverAssessed</p>
</td></tr>`;
  
  return wrapEmail({
    body,
    preheader: `We've saved your property at ${propertyAddress}. We'll reach out when notices drop.`
  });
}

// ─────────────────────────────────────────────────
// TEMPLATE 2: Lead Acknowledgment (simple lead / PPC)
// ─────────────────────────────────────────────────
function leadAcknowledgmentEmail({ propertyAddress }) {
  const body = `
<tr><td style="padding:16px 24px 8px 24px; font-family:${BRAND.font};">
  <p style="margin:0; font-size:21px; line-height:26px; font-weight:bold; color:${BRAND.textDark};">We've Received Your Property</p>
  <p style="margin:4px 0 0 0; font-size:14px; line-height:20px; color:${BRAND.textMuted};">Your analysis is in progress</p>
</td></tr>
<tr><td style="padding:8px 24px 12px 24px; font-family:${BRAND.font};">
  <p style="margin:0 0 12px 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">Hi there,</p>
  <p style="margin:0 0 12px 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">Thanks for submitting <strong>${propertyAddress}</strong> for review.</p>
  <p style="margin:0 0 12px 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">We're currently analyzing your property to identify potential tax savings. One of our specialists will review your case and follow up with you shortly.</p>
  <p style="margin:0 0 0 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">If you'd like to speed things up, reply to this email with any additional details or questions.</p>
</td></tr>
<tr><td style="padding:4px 24px 14px 24px; font-family:${BRAND.font};">
  <p style="margin:0; font-size:13px; color:${BRAND.textMuted};">&mdash; OverAssessed Team</p>
</td></tr>`;
  
  return wrapEmail({
    body,
    preheader: `We're analyzing ${propertyAddress} for potential tax savings.`
  });
}

// ─────────────────────────────────────────────────
// TEMPLATE 3: Analysis Complete (with savings)
// ─────────────────────────────────────────────────
function analysisCompleteEmail({ firstName, propertyAddress, county, year, assessed, recommended, savings, reduction, compCount, caseNum, agreementUrl }) {
  const body = `
<tr><td style="padding:16px 24px 8px 24px; font-family:${BRAND.font};">
  <p style="margin:0; font-size:21px; line-height:26px; font-weight:bold; color:${BRAND.textDark};">Your Property Tax Analysis Is Ready</p>
  <p style="margin:4px 0 0 0; font-size:14px; line-height:20px; color:${BRAND.textMuted};">Hi ${firstName || 'there'}, here's what we found for your property.</p>
</td></tr>

<!-- SAVINGS BOX -->
<tr><td style="padding:8px 24px 10px 24px;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr>
    <td style="background-color:${BRAND.green}; padding:14px 20px;">
      <p style="margin:0 0 2px 0; font-size:11px; font-weight:bold; color:#ffffff; text-transform:uppercase; letter-spacing:1px; font-family:${BRAND.font};">Estimated Annual Savings</p>
      <p style="margin:0; font-size:36px; font-weight:bold; color:#ffffff; letter-spacing:-1px; line-height:40px; font-family:${BRAND.font};">${savings}<span style="font-size:16px; font-weight:normal; color:${BRAND.greenMuted};">/year</span></p>
    </td>
  </tr></table>
</td></tr>

<!-- VALUE COMPARISON -->
<tr><td style="padding:4px 24px 10px 24px;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr>
    <td width="48%" valign="top" style="background-color:${BRAND.bgStatLight}; padding:10px 14px; font-family:${BRAND.font};">
      <p style="margin:0 0 2px 0; font-size:10px; font-weight:bold; color:${BRAND.textMuted}; text-transform:uppercase; letter-spacing:1px;">Current Assessed</p>
      <p style="margin:0; font-size:21px; font-weight:bold; color:${BRAND.textDark};">${assessed}</p>
      <p style="margin:2px 0 0 0; font-size:11px; color:${BRAND.textMuted};">${county} County ${year || ''}</p>
    </td>
    <td width="4%" style="font-size:0; line-height:0;">&nbsp;</td>
    <td width="48%" valign="top" style="background-color:${BRAND.purpleLight}; border-left:3px solid ${BRAND.purple}; padding:10px 14px; font-family:${BRAND.font};">
      <p style="margin:0 0 2px 0; font-size:10px; font-weight:bold; color:${BRAND.textMuted}; text-transform:uppercase; letter-spacing:1px;">Our Recommendation</p>
      <p style="margin:0; font-size:21px; font-weight:bold; color:${BRAND.purple};">${recommended}</p>
      <p style="margin:2px 0 0 0; font-size:11px; color:${BRAND.purple}; font-weight:bold;">&#8595; ${reduction} reduction</p>
    </td>
  </tr></table>
</td></tr>

<!-- SUMMARY -->
<tr><td style="padding:4px 24px 12px 24px; font-family:${BRAND.font};">
  <p style="margin:0; font-size:14px; line-height:20px; color:${BRAND.textBody};">Based on <strong>${compCount} comparable properties</strong> in ${county} County, your home at <strong>${propertyAddress}</strong> appears to be assessed above market value. We'll provide the full evidence packet and handle the filing once you approve.</p>
</td></tr>

<!-- CTA -->
<tr><td align="center" style="padding:4px 24px 6px 24px;">
  ${ctaButton('Approve &amp; Continue &#8594;', agreementUrl)}
  <p style="margin:6px 0 0 0; font-size:12px; color:${BRAND.textMuted}; font-family:${BRAND.font};">You only pay if we save you money. No upfront cost.</p>
</td></tr>

${divider()}

<!-- HOW IT WORKS -->
<tr><td style="padding:10px 24px 14px 24px; font-family:${BRAND.font};">
  <p style="margin:0 0 8px 0; font-size:12px; font-weight:bold; color:${BRAND.textDark}; text-transform:uppercase; letter-spacing:1px;">How It Works</p>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
    <tr>
      <td width="28" valign="top" style="padding:0 0 6px 0;">
        <!--[if mso]><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="background-color:${BRAND.purpleLight}; width:20px; height:20px; text-align:center; font-size:10px; font-weight:bold; color:${BRAND.purple}; font-family:Arial;">1</td></tr></table><![endif]-->
        <!--[if !mso]><!--><span style="display:inline-block; width:20px; height:20px; background-color:${BRAND.purpleLight}; color:${BRAND.purple}; font-size:10px; font-weight:bold; text-align:center; line-height:20px; border-radius:50%;">1</span><!--<![endif]-->
      </td>
      <td style="padding:0 0 6px 4px; font-size:13px; line-height:18px; color:${BRAND.textBody};"><strong>Approve</strong> &mdash; sign the fee agreement (60 seconds)</td>
    </tr>
    <tr>
      <td width="28" valign="top" style="padding:0 0 6px 0;">
        <!--[if mso]><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="background-color:${BRAND.purpleLight}; width:20px; height:20px; text-align:center; font-size:10px; font-weight:bold; color:${BRAND.purple}; font-family:Arial;">2</td></tr></table><![endif]-->
        <!--[if !mso]><!--><span style="display:inline-block; width:20px; height:20px; background-color:${BRAND.purpleLight}; color:${BRAND.purple}; font-size:10px; font-weight:bold; text-align:center; line-height:20px; border-radius:50%;">2</span><!--<![endif]-->
      </td>
      <td style="padding:0 0 6px 4px; font-size:13px; line-height:18px; color:${BRAND.textBody};"><strong>Evidence</strong> &mdash; we prepare your full support package after you approve</td>
    </tr>
    <tr>
      <td width="28" valign="top" style="padding:0;">
        <!--[if mso]><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="background-color:${BRAND.greenLight}; width:20px; height:20px; text-align:center; font-size:10px; font-weight:bold; color:${BRAND.green}; font-family:Arial;">3</td></tr></table><![endif]-->
        <!--[if !mso]><!--><span style="display:inline-block; width:20px; height:20px; background-color:${BRAND.greenLight}; color:${BRAND.green}; font-size:10px; font-weight:bold; text-align:center; line-height:20px; border-radius:50%;">3</span><!--<![endif]-->
      </td>
      <td style="padding:0 0 0 4px; font-size:13px; line-height:18px; color:${BRAND.textBody};"><strong>We file</strong> your protest and handle the hearing</td>
    </tr>
  </table>
</td></tr>

<!-- DISCLAIMER -->
<tr><td style="padding:0 24px 12px 24px; font-family:${BRAND.font};">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr>
    <td style="background-color:${BRAND.bgDisclaimer}; padding:8px 12px; font-size:11px; line-height:16px; color:${BRAND.textFaint};">
      Savings estimate based on current ${county} County tax rates and verified comparable property data. Actual results depend on the appraisal review board's decision. Our fee is 25% of the first year's confirmed tax savings &mdash; you pay nothing if there's no reduction.
    </td>
  </tr></table>
</td></tr>`;

  return wrapEmail({
    body,
    preheader: `Your property tax analysis is ready — we found potential savings of ${savings}/year.`
  });
}

// ─────────────────────────────────────────────────
// TEMPLATE 4: Analysis In Progress (partial comps)
// ─────────────────────────────────────────────────
function analysisInProgressEmail({ propertyAddress, assessed, caseNum }) {
  const body = `
<tr><td style="padding:16px 24px 8px 24px; font-family:${BRAND.font};">
  <p style="margin:0; font-size:21px; line-height:26px; font-weight:bold; color:${BRAND.textDark};">Your Analysis Is In Progress</p>
  <p style="margin:4px 0 0 0; font-size:14px; line-height:20px; color:${BRAND.textMuted};">We're gathering data for your case</p>
</td></tr>
<tr><td style="padding:8px 24px 12px 24px; font-family:${BRAND.font};">
  <p style="margin:0 0 12px 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">We found your property at <strong>${propertyAddress}</strong>${assessed ? ` with an assessed value of <strong>${assessed}</strong>` : ''}.</p>
  <p style="margin:0 0 12px 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">We're still gathering comparable properties to ensure our analysis meets our quality standards. To speed things up, you can:</p>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 12px 0;">
    <tr><td style="padding:3px 0; font-size:14px; color:${BRAND.textBody}; font-family:${BRAND.font};"><strong>1.</strong> Reply with your <strong>Notice of Appraised Value</strong> (photo or scan)</td></tr>
    <tr><td style="padding:3px 0; font-size:14px; color:${BRAND.textBody}; font-family:${BRAND.font};"><strong>2.</strong> Share any recent appraisals or sales data for nearby homes</td></tr>
  </table>
  <p style="margin:0 0 0 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">We'll have your complete analysis within 24&ndash;48 hours.</p>
</td></tr>
<tr><td style="padding:4px 24px 14px 24px; font-family:${BRAND.font};">
  <p style="margin:0; font-size:13px; color:${BRAND.textMuted};">&mdash; Tyler Worthey, OverAssessed</p>
</td></tr>`;

  return wrapEmail({
    body,
    preheader: `We're working on your analysis for ${propertyAddress}. Almost there.`
  });
}

// ─────────────────────────────────────────────────
// TEMPLATE 5: Upload Notice Request (0 comps or no data)
// ─────────────────────────────────────────────────
function uploadNoticeEmail({ propertyAddress, caseNum }) {
  const body = `
<tr><td style="padding:16px 24px 8px 24px; font-family:${BRAND.font};">
  <p style="margin:0; font-size:21px; line-height:26px; font-weight:bold; color:${BRAND.textDark};">We Need One More Thing</p>
  <p style="margin:4px 0 0 0; font-size:14px; line-height:20px; color:${BRAND.textMuted};">Upload your notice to complete your analysis</p>
</td></tr>
<tr><td style="padding:8px 24px 12px 24px; font-family:${BRAND.font};">
  <p style="margin:0 0 12px 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">Thanks for submitting your property at <strong>${propertyAddress}</strong>.</p>
  <p style="margin:0 0 12px 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">To complete your analysis and calculate your exact savings, we need your <strong>Notice of Appraised Value</strong> from your county appraisal district.</p>
  <p style="margin:0 0 8px 0; font-size:14px; line-height:21px; font-weight:bold; color:${BRAND.textDark};">What to do:</p>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 12px 0;">
    <tr><td style="padding:3px 0; font-size:14px; color:${BRAND.textBody}; font-family:${BRAND.font};"><strong>1.</strong> Check your mail for the notice (usually arrives April&ndash;May)</td></tr>
    <tr><td style="padding:3px 0; font-size:14px; color:${BRAND.textBody}; font-family:${BRAND.font};"><strong>2.</strong> Take a photo or scan it</td></tr>
    <tr><td style="padding:3px 0; font-size:14px; color:${BRAND.textBody}; font-family:${BRAND.font};"><strong>3.</strong> Reply to this email with the image attached</td></tr>
  </table>
  <p style="margin:0 0 0 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">Once we have your notice, we'll complete your analysis within 24 hours and let you know exactly how much you can save.</p>
</td></tr>
<tr><td style="padding:4px 24px 14px 24px; font-family:${BRAND.font};">
  <p style="margin:0; font-size:13px; color:${BRAND.textMuted};">&mdash; Tyler Worthey, OverAssessed</p>
</td></tr>`;

  return wrapEmail({
    body,
    preheader: `We need your appraisal notice to finish your analysis for ${propertyAddress}.`
  });
}

// ─────────────────────────────────────────────────
// TEMPLATE 6: Filing Approved
// ─────────────────────────────────────────────────
function filingApprovedEmail({ firstName, propertyAddress, county, compCount }) {
  const body = `
<tr><td style="padding:16px 24px 8px 24px; font-family:${BRAND.font};">
  <p style="margin:0; font-size:21px; line-height:26px; font-weight:bold; color:${BRAND.textDark};">Your Protest Is Being Filed</p>
  <p style="margin:4px 0 0 0; font-size:14px; line-height:20px; color:${BRAND.textMuted};">We're submitting to ${county} County</p>
</td></tr>
<tr><td style="padding:8px 24px 12px 24px; font-family:${BRAND.font};">
  <p style="margin:0 0 12px 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">Hi ${firstName || 'there'},</p>
  <p style="margin:0 0 12px 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">Great news &mdash; your property tax protest for <strong>${propertyAddress}</strong> has been approved for filing.</p>
  <p style="margin:0 0 12px 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">We're submitting to ${county} County with <strong>${compCount} comparable sales</strong> supporting a reduced value.</p>
  <p style="margin:0 0 12px 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">You don't need to do anything. We'll notify you when filed and when we receive a response.</p>
</td></tr>

<!-- STATUS BOX -->
<tr><td style="padding:0 24px 14px 24px;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%"><tr>
    <td style="background-color:${BRAND.greenLight}; padding:10px 14px; border-left:3px solid ${BRAND.green}; font-family:${BRAND.font};">
      <p style="margin:0 0 2px 0; font-size:10px; font-weight:bold; color:${BRAND.green}; text-transform:uppercase; letter-spacing:1px;">Status</p>
      <p style="margin:0; font-size:14px; font-weight:bold; color:${BRAND.textDark};">Filing in progress</p>
    </td>
  </tr></table>
</td></tr>

<tr><td style="padding:4px 24px 14px 24px; font-family:${BRAND.font};">
  <p style="margin:0; font-size:13px; color:${BRAND.textMuted};">&mdash; OverAssessed Team</p>
</td></tr>`;

  return wrapEmail({
    body,
    preheader: `Your property tax protest for ${propertyAddress} is being filed with ${county} County.`
  });
}

// ─────────────────────────────────────────────────
// TEMPLATE 7: Notice Upload Reminder (when notices drop)
// ─────────────────────────────────────────────────
function noticeUploadReminderEmail({ firstName, propertyAddress, county, uploadUrl }) {
  const body = `
<tr><td style="padding:16px 24px 8px 24px; font-family:${BRAND.font};">
  <p style="margin:0; font-size:21px; line-height:26px; font-weight:bold; color:${BRAND.textDark};">Appraisal Notices Are Out</p>
  <p style="margin:4px 0 0 0; font-size:14px; line-height:20px; color:${BRAND.textMuted};">Upload yours and we'll get to work</p>
</td></tr>
<tr><td style="padding:8px 24px 12px 24px; font-family:${BRAND.font};">
  <p style="margin:0 0 12px 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">Hi ${firstName},</p>
  <p style="margin:0 0 12px 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">${county} County appraisal notices have been released. Your property at <strong>${propertyAddress}</strong> is ready for analysis.</p>
  <p style="margin:0 0 12px 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">Upload your notice and we'll calculate your exact savings within 24 hours:</p>
</td></tr>
<tr><td align="center" style="padding:0 24px 6px 24px;">
  ${ctaButton('Upload My Notice &#8594;', uploadUrl || 'https://overassessed.ai/upload')}
  <p style="margin:6px 0 0 0; font-size:12px; color:${BRAND.textMuted}; font-family:${BRAND.font};">Takes about 30 seconds. Just snap a photo.</p>
</td></tr>
<tr><td style="padding:8px 24px 14px 24px; font-family:${BRAND.font};">
  <p style="margin:0 0 8px 0; font-size:14px; line-height:21px; color:${BRAND.textBody};">Don't have your notice yet? You can also reply with:</p>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 12px 0;">
    <tr><td style="padding:2px 0 2px 8px; font-size:14px; color:${BRAND.textBody};">&#8226; Your property account number</td></tr>
    <tr><td style="padding:2px 0 2px 8px; font-size:14px; color:${BRAND.textBody};">&#8226; Your new assessed value</td></tr>
  </table>
</td></tr>`;

  return wrapEmail({
    body,
    preheader: `${county} County notices are out. Upload yours — we'll have your savings estimate in 24 hours.`
  });
}

module.exports = {
  BRAND,
  wrapEmail,
  ctaButton,
  divider,
  preRegistrationEmail,
  leadAcknowledgmentEmail,
  analysisCompleteEmail,
  analysisInProgressEmail,
  uploadNoticeEmail,
  filingApprovedEmail,
  noticeUploadReminderEmail
};
