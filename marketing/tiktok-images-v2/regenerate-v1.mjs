import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const slides = [
  { file: '01-tx-shock.png', headline: 'Your Property\nTax Bill Is\nToo High', sub: 'Texas homeowners overpay\nby thousands every year.', tag: 'TX', accent: '#e74c3c' },
  { file: '03-tx-myths.png', headline: '3 Myths About\nProperty Tax\nProtests', sub: '"It\'s too hard." FALSE.\n"It doesn\'t work." FALSE.\n"It costs too much." FALSE.', tag: 'TX', accent: '#fdcb6e' },
  { file: '04-ga-urgency.png', headline: 'GA Deadline\nIs Coming\nFast', sub: '45 days from your notice.\nDon\'t miss it.', tag: 'GA', accent: '#e74c3c' },
  { file: '05-tx-math.png', headline: 'Do The Math:\n$1,500/Year\n× 10 Years', sub: 'That\'s $15,000 you\'re\ngiving away.', tag: 'TX', accent: '#00b894' },
  { file: '06-ga-howto.png', headline: 'How We\nLower Your\nGA Taxes', sub: 'Step 1: Free analysis\nStep 2: We file for you\nStep 3: You save money', tag: 'GA', accent: '#0984e3' },
  { file: '08-comparison.png', headline: 'OverAssessed\nvs. DIY\nProtest', sub: 'We know the comps.\nWe know the process.\nYou keep the savings.', tag: 'UNI', accent: '#6c5ce7' },
  { file: '09-ga-atlanta.png', headline: 'Atlanta\nHomeowners:\nYou\'re Overpaying', sub: 'Fulton, DeKalb, Gwinnett, Cobb.\nWe cover all metro ATL.', tag: 'GA', accent: '#fdcb6e' },
  { file: '10-tx-deadline.png', headline: 'TX Protest\nDeadline:\nMay 15', sub: 'Notices come mid-April.\nFile before it\'s too late.', tag: 'TX', accent: '#e74c3c' },
];

function buildHTML(s) {
  const lines = s.headline.split('\n');
  const headlineHTML = lines.map(l => `<div>${l}</div>`).join('');
  const subLines = s.sub.split('\n').map(l => `<div>${l}</div>`).join('');
  const angles = { TX: '160deg', GA: '200deg', UNI: '180deg', WA: '150deg' };
  const angle = angles[s.tag] || '180deg';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@800;900&family=DM+Sans:wght@400;500&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width: 1080px; height: 1920px;
    background: linear-gradient(${angle}, #1a0533 0%, #0f1a3e 40%, #0a2351 100%);
    display: flex; flex-direction: column;
    justify-content: center; align-items: center;
    padding: 80px 70px;
    position: relative;
    overflow: hidden;
  }
  .glow {
    position: absolute;
    width: 600px; height: 600px;
    border-radius: 50%;
    background: ${s.accent};
    opacity: 0.08;
    filter: blur(120px);
    top: 15%; right: -15%;
  }
  .glow2 {
    position: absolute;
    width: 400px; height: 400px;
    border-radius: 50%;
    background: #6c5ce7;
    opacity: 0.10;
    filter: blur(100px);
    bottom: 20%; left: -10%;
  }
  .tag {
    position: absolute;
    top: 100px; left: 70px;
    font-family: 'DM Sans', sans-serif;
    font-weight: 500;
    font-size: 32px;
    color: ${s.accent};
    letter-spacing: 4px;
    text-transform: uppercase;
  }
  .headline {
    font-family: 'Inter', sans-serif;
    font-weight: 900;
    font-size: 108px;
    color: #fff;
    text-align: center;
    line-height: 1.08;
    text-shadow: 0 4px 30px rgba(0,0,0,0.5);
    z-index: 2;
  }
  .divider {
    width: 120px; height: 5px;
    background: ${s.accent};
    border-radius: 3px;
    margin: 40px 0;
    z-index: 2;
  }
  .sub {
    font-family: 'DM Sans', sans-serif;
    font-weight: 500;
    font-size: 44px;
    color: rgba(255,255,255,0.85);
    text-align: center;
    line-height: 1.45;
    z-index: 2;
  }
  .footer {
    position: absolute;
    bottom: 80px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    z-index: 2;
  }
  .footer .brand {
    font-family: 'Inter', sans-serif;
    font-weight: 900;
    font-size: 38px;
    color: rgba(255,255,255,0.7);
    letter-spacing: 2px;
  }
  .footer .url {
    font-family: 'DM Sans', sans-serif;
    font-size: 30px;
    color: ${s.accent};
    letter-spacing: 1px;
  }
</style>
</head>
<body>
  <div class="glow"></div>
  <div class="glow2"></div>
  <div class="tag">${s.tag === 'UNI' ? 'OVERASSESSED' : s.tag}</div>
  <div class="headline">${headlineHTML}</div>
  <div class="divider"></div>
  <div class="sub">${subLines}</div>
  <div class="footer">
    <div class="brand">OVERASSESSED</div>
    <div class="url">overassessed.ai</div>
  </div>
</body></html>`;
}

(async () => {
  const browser = await chromium.launch();
  
  for (const s of slides) {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    await page.setContent(buildHTML(s), { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const buf = await page.screenshot({ type: 'png' });
    
    // Save to v1 location (replaces old small-text version)
    writeFileSync(`/Users/aquabot/Documents/OverAssessed/marketing/tiktok-images/${s.file}`, buf);
    // Also to server public
    writeFileSync(`/Users/aquabot/Documents/OverAssessed/server/public/tiktok/${s.file}`, buf);
    
    console.log(`✅ ${s.file}`);
    await page.close();
  }
  
  await browser.close();
  console.log('\n🎉 All 8 images regenerated with big text!');
})();
