import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@700;800;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width: 1080px; height: 1920px;
    background: linear-gradient(160deg, #1a0533 0%, #0f1a3e 40%, #0a2351 100%);
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
    background: #e74c3c;
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
    font-family: 'Inter', sans-serif;
    font-weight: 700;
    font-size: 36px;
    color: #e74c3c;
    letter-spacing: 4px;
    text-transform: uppercase;
  }
  .headline {
    font-family: 'Inter', sans-serif;
    font-weight: 900;
    font-size: 96px;
    color: #fff;
    text-align: center;
    line-height: 1.1;
    text-shadow: 0 4px 30px rgba(0,0,0,0.5);
    margin-bottom: 60px;
    z-index: 2;
  }
  .stats {
    z-index: 2;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 28px;
    margin-bottom: 60px;
  }
  .stat-row {
    display: flex;
    align-items: center;
    gap: 24px;
    background: rgba(255,255,255,0.08);
    border-radius: 20px;
    padding: 28px 40px;
    border-left: 6px solid;
  }
  .stat-num {
    font-family: 'Inter', sans-serif;
    font-weight: 900;
    font-size: 72px;
    min-width: 280px;
    text-align: right;
  }
  .stat-label {
    font-family: 'Inter', sans-serif;
    font-weight: 700;
    font-size: 44px;
    color: rgba(255,255,255,0.9);
  }
  .bottom-text {
    font-family: 'Inter', sans-serif;
    font-weight: 900;
    font-size: 76px;
    text-align: center;
    z-index: 2;
    line-height: 1.15;
    margin-bottom: 30px;
  }
  .cta {
    font-family: 'Inter', sans-serif;
    font-weight: 900;
    font-size: 80px;
    color: #00b894;
    text-align: center;
    z-index: 2;
  }
  .footer {
    position: absolute;
    bottom: 60px;
    font-family: 'Inter', sans-serif;
    font-weight: 700;
    font-size: 32px;
    color: rgba(255,255,255,0.5);
    z-index: 2;
  }
</style>
</head>
<body>
  <div class="glow"></div>
  <div class="glow2"></div>
  <div class="tag">TEXAS</div>
  
  <div class="headline">Property Tax<br>Protest Stats</div>
  
  <div class="stats">
    <div class="stat-row" style="border-color: #e74c3c;">
      <div class="stat-num" style="color: #e74c3c;">6%</div>
      <div class="stat-label">of homeowners protest</div>
    </div>
    <div class="stat-row" style="border-color: #00b894;">
      <div class="stat-num" style="color: #00b894;">70%</div>
      <div class="stat-label">of protests WIN</div>
    </div>
    <div class="stat-row" style="border-color: #fdcb6e;">
      <div class="stat-num" style="color: #fdcb6e;">$1,500</div>
      <div class="stat-label">average savings/yr</div>
    </div>
    <div class="stat-row" style="border-color: #0984e3;">
      <div class="stat-num" style="color: #0984e3;">10 min</div>
      <div class="stat-label">to file a protest</div>
    </div>
  </div>
  
  <div class="bottom-text" style="color: #e74c3c;">94% are paying extra<br>for no reason.</div>
  <div class="cta">Be the 6%.</div>
  
  <div class="footer">overassessed.ai • Free Property Tax Analysis</div>
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const buf = await page.screenshot({ type: 'png' });
  
  // Save to v1 location (replaces old small-text version)
  writeFileSync('/Users/aquabot/Documents/OverAssessed/marketing/tiktok-images/07-tx-stats.png', buf);
  console.log('✅ Saved to tiktok-images/07-tx-stats.png');
  
  // Also copy to server public
  writeFileSync('/Users/aquabot/Documents/OverAssessed/server/public/tiktok/07-tx-stats.png', buf);
  console.log('✅ Copied to server/public/tiktok/');
  
  await browser.close();
})();
