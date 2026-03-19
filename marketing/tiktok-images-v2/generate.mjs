import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';

const OUT = '/Users/aquabot/Documents/OverAssessed/marketing/tiktok-images-v2';

const slides = [
  // === TX (5) ===
  { file: 'tx-01-overpaying.png', headline: 'TX Homeowners:\nYou\'re Overpaying', sub: 'Your county is overvaluing your home.\nWe fix that.', tag: 'TX', accent: '#e74c3c' },
  { file: 'tx-02-edward.png', headline: 'We Got\n$2,913 Back\nfor Edward', sub: 'Real client. Real savings.\nYou could be next.', tag: 'TX', accent: '#f39c12' },
  { file: 'tx-03-fight.png', headline: 'Property Taxes\nUp 30%?\nFight It.', sub: 'Texas values are skyrocketing.\nDon\'t just accept it.', tag: 'TX', accent: '#e74c3c' },
  { file: 'tx-04-neighbor.png', headline: 'Your Neighbor\nIs Paying Less', sub: 'Same street. Lower taxes.\nFind out why.', tag: 'TX', accent: '#00cec9' },
  { file: 'tx-05-no-risk.png', headline: 'Free Analysis.\nNo Risk.', sub: 'We only get paid when\nyou save money.', tag: 'TX', accent: '#00b894' },
  // === GA (5) ===
  { file: 'ga-01-freeze.png', headline: 'GA Homeowners:\n3-Year\nValue Freeze', sub: 'Lock in your assessed value.\nStop surprise increases.', tag: 'GA', accent: '#fdcb6e' },
  { file: 'ga-02-wrong.png', headline: 'Your Tax Bill\nIs Wrong', sub: 'Georgia assessments are riddled\nwith errors. We find them.', tag: 'GA', accent: '#e74c3c' },
  { file: 'ga-03-97pct.png', headline: '97% of Protests\nGet Reductions', sub: 'The odds are in your favor.\nLet us handle it.', tag: 'GA', accent: '#00b894' },
  { file: 'ga-04-handle.png', headline: 'We Handle\nEverything.\nYou Save.', sub: 'From filing to hearing.\nZero hassle for you.', tag: 'GA', accent: '#0984e3' },
  { file: 'ga-05-dont-pay.png', headline: 'Don\'t Pay\nUntil We\nSave You Money', sub: 'No savings = no fee.\nIt\'s that simple.', tag: 'GA', accent: '#00cec9' },
  // === Universal (5) ===
  { file: 'uni-01-not-worth.png', headline: 'Your Home\nISN\'T Worth\nThat Much', sub: 'But your county says it is.\nLet us prove them wrong.', tag: 'UNI', accent: '#e74c3c' },
  { file: 'uni-02-fight-back.png', headline: 'Fight Back\nAgainst\nUnfair Taxes', sub: 'Homeowners are overpaying\nby thousands every year.', tag: 'UNI', accent: '#fdcb6e' },
  { file: 'uni-03-stop.png', headline: 'Stop\nOverpaying\nProperty Taxes', sub: 'Most homeowners never protest.\nBig mistake.', tag: 'UNI', accent: '#e74c3c' },
  { file: 'uni-04-avg-savings.png', headline: 'Average\nSavings:\n$1,500/Year', sub: 'That\'s money back in\nyour pocket. Every year.', tag: 'UNI', accent: '#00b894' },
  { file: 'uni-05-wa.png', headline: 'WA Property\nTaxes\nToo High?', sub: 'Washington homeowners deserve\nfair assessments too.', tag: 'WA', accent: '#0984e3' },
];

function buildHTML(s) {
  const lines = s.headline.split('\n');
  const headlineHTML = lines.map(l => `<div>${l}</div>`).join('');
  const subLines = s.sub.split('\n').map(l => `<div>${l}</div>`).join('');
  
  // Vary gradient angle per slide for visual variety
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
  /* Decorative accent glow */
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
  /* Small top tag */
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
    color: #ffffff;
    text-align: center;
    line-height: 1.08;
    letter-spacing: -2px;
    text-shadow: 0 4px 40px rgba(0,0,0,0.5);
    z-index: 2;
    margin-bottom: 50px;
  }
  .sub {
    font-family: 'DM Sans', sans-serif;
    font-weight: 400;
    font-size: 38px;
    color: rgba(255,255,255,0.75);
    text-align: center;
    line-height: 1.5;
    z-index: 2;
  }
  /* Accent bar */
  .bar {
    width: 100px; height: 6px;
    background: ${s.accent};
    border-radius: 3px;
    margin-bottom: 50px;
    z-index: 2;
  }
  .bottom {
    position: absolute;
    bottom: 90px;
    font-family: 'DM Sans', sans-serif;
    font-weight: 500;
    font-size: 34px;
    color: rgba(255,255,255,0.45);
    letter-spacing: 2px;
    z-index: 2;
  }
</style></head><body>
  <div class="glow"></div>
  <div class="glow2"></div>
  <div class="tag">${s.tag === 'UNI' ? 'OVERASSESSED' : s.tag === 'WA' ? 'WASHINGTON' : s.tag === 'TX' ? 'TEXAS' : 'GEORGIA'}</div>
  <div class="headline">${headlineHTML}</div>
  <div class="bar"></div>
  <div class="sub">${subLines}</div>
  <div class="bottom">overassessed.ai</div>
</body></html>`;
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  
  for (const s of slides) {
    const page = await ctx.newPage();
    await page.setContent(buildHTML(s), { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(OUT, s.file), type: 'png' });
    await page.close();
    console.log(`✅ ${s.file}`);
  }
  
  await browser.close();
  console.log(`\nDone! ${slides.length} images generated.`);
}

main().catch(e => { console.error(e); process.exit(1); });
