const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BRAND = {
  gradient: 'linear-gradient(135deg, #6c5ce7, #0984e3)',
  accent: '#6c5ce7',
  blue: '#0984e3',
  dark: '#1a1a2e',
  url: 'overassessed.ai',
  phone: '(888) 282-9165'
};

const ANGLES = [
  { headline: "Your Property Taxes Are Too High", sub: "The average homeowner saves $1,200+ per year with a successful protest." },
  { headline: "Stop Overpaying Property Taxes", sub: "Most homeowners don't realize they're paying too much. We find the errors they miss." },
  { headline: "Your Home Is Probably Overassessed", sub: "County appraisals use mass models, not individual analysis. We fix that." },
  { headline: "Property Taxes Went Up Again?", sub: "You have the right to protest. We handle everything for you." },
  { headline: "Don't Pay More Than You Owe", sub: "Over half of protests result in a reduction. The odds are in your favor." },
  { headline: "No Savings, No Fee", sub: "We only get paid if we save you money. Zero risk, zero upfront cost." },
  { headline: "Save $1,200+ Per Year", sub: "The average successful protest saves homeowners over a thousand dollars annually." },
  { headline: "We Handle Your Entire Protest", sub: "From pulling comps to representing you at the hearing. You do nothing." },
  { headline: "Free Property Tax Analysis", sub: "Find out in 24 hours if you're overpaying. No obligation." },
  { headline: "Expert Representation, No Upfront Cost", sub: "Our team fights for your reduction. You only pay if we win." },
  { headline: "Deadline Approaching", sub: "Don't miss your chance to protest. File before the deadline passes." },
  { headline: "Property Tax Notices Are Out", sub: "Now is the time to act. Get your free analysis before the filing deadline." },
  { headline: "Last Chance to Lower Your Taxes", sub: "The protest window closes soon. Start your free analysis today." },
  { headline: "Thousands of Homeowners Saved", sub: "Join homeowners across Texas, Georgia, and Washington who pay less." },
  { headline: "Average Savings: $1,200/Year", sub: "Our clients save big. No win, no fee guarantee." },
  { headline: "Texas Homeowners: You're Overpaying", sub: "TX property taxes are among the highest in the nation. Fight back." },
  { headline: "Georgia Property Tax Protest", sub: "One successful appeal freezes your value for 3 years. Triple savings." },
  { headline: "Washington State Property Taxes", sub: "King, Pierce, Snohomish, Clark County homeowners - we can help." },
  { headline: "Did Your Assessment Go Up?", sub: "You don't have to accept it. Protest and save." },
  { headline: "Paying Too Much in Property Taxes?", sub: "Find out in 60 seconds. Free analysis, no obligation." },
];

function boldTemplate(angle) {
  return `
    <div style="width:1080px;height:1080px;background:${BRAND.gradient};display:flex;flex-direction:column;justify-content:center;align-items:center;padding:100px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center;overflow:hidden;">
      <div style="font-size:52px;font-weight:900;color:white;line-height:1.2;margin-bottom:32px;max-width:100%;word-wrap:break-word;">${angle.headline}</div>
      <div style="font-size:26px;color:rgba(255,255,255,0.9);line-height:1.5;margin-bottom:50px;max-width:780px;">${angle.sub}</div>
      <div style="background:white;color:${BRAND.accent};font-size:30px;font-weight:800;padding:22px 50px;border-radius:50px;box-shadow:0 8px 30px rgba(0,0,0,0.2);">Get Your Free Analysis</div>
      <div style="margin-top:32px;font-size:22px;color:rgba(255,255,255,0.8);">${BRAND.url} | No Win, No Fee</div>
    </div>`;
}

function cardTemplate(angle) {
  return `
    <div style="width:1080px;height:1080px;background:#f8f9fa;display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;overflow:hidden;">
      <div style="background:${BRAND.gradient};padding:40px 60px;">
        <div style="font-size:26px;color:rgba(255,255,255,0.9);font-weight:700;letter-spacing:2px;text-transform:uppercase;">OVERASSESSED</div>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding:60px 70px;">
        <div style="font-size:48px;font-weight:900;color:#1a1a2e;line-height:1.2;margin-bottom:24px;">${angle.headline}</div>
        <div style="font-size:24px;color:#555;line-height:1.5;margin-bottom:40px;">${angle.sub}</div>
        <div style="display:flex;align-items:center;">
          <div style="background:${BRAND.accent};color:white;font-size:24px;font-weight:700;padding:18px 40px;border-radius:12px;">Start Free Analysis</div>
          <div style="font-size:20px;color:#888;margin-left:20px;">No upfront cost</div>
        </div>
      </div>
      <div style="background:${BRAND.dark};padding:28px 60px;display:flex;justify-content:space-between;align-items:center;">
        <div style="color:white;font-size:20px;">${BRAND.url}</div>
        <div style="color:rgba(255,255,255,0.7);font-size:18px;">${BRAND.phone}</div>
      </div>
    </div>`;
}

const TEMPLATES = { bold: boldTemplate, card: cardTemplate };

async function generateAds() {
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1080, height: 1080 });

  const templateNames = Object.keys(TEMPLATES);

  for (let i = 0; i < ANGLES.length; i++) {
    const angle = ANGLES[i];
    const templateName = templateNames[i % templateNames.length];
    const template = TEMPLATES[templateName];
    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;">' + template(angle) + '</body></html>';

    await page.setContent(html, { waitUntil: 'networkidle' });
    const filename = 'oa-ad-' + String(i+1).padStart(2,'0') + '-' + templateName + '.png';
    await page.screenshot({ path: path.join(outputDir, filename), type: 'png' });
    console.log('✅ ' + filename + ' — "' + angle.headline + '"');
  }

  await browser.close();
  console.log('\n🎉 Generated ' + ANGLES.length + ' ads in ' + outputDir + '/');
}

generateAds().catch(console.error);
