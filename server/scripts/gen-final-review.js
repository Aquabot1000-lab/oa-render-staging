const fs = require('fs');
const path = require('path');

// Data from previous runs for Rupani, Runyon, Dickinson
const Rupani = {
  caseNum: 'OA-0013', name: 'Shabir Hasanali Rupani', county: 'Collin',
  marketValue: 399042, medV: 377467, diff: -21575, diffPct: '-5.4%', status: 'READY',
  notes: 'Strong case with good comps and clear over-assessment.'
};

const Runyon = {
  caseNum: 'OA-0037', name: 'Sherman Roy Runyon', county: 'Kitsap',
  marketValue: 473100, medV: 350882, diff: -122218, diffPct: '-25.8%', status: 'READY',
  notes: 'Strongest case with significant reduction supported by comps.'
};

const Dickinson = {
  caseNum: 'OA-0039', name: 'Elton Dickinson', county: 'Stevens',
  marketValue: 276200, medV: 256206, diff: -19994, diffPct: '-7.2%', status: 'READY',
  notes: 'Sufficient reduction supported by comps, though some feature/land values were estimated due to data limitations.'
};

// --- Matthews (OA-0022) --- NO PROTEST RECOMMENDED
const Matthews = {
  caseNum: 'OA-0022', name: 'Jason Michael Matthews', county: 'Kaufman',
  marketValue: 418156, medV: 422610, diff: -4454, diffPct: '-1.1%', status: 'DO NOT FILE',
  notes: 'Median adjusted value of comparable properties ($422,610) exceeds the subject\'s appraised value ($418,156). The current data does not support a reduction for over-assessment.'
};

// --- Tran (OA-0030) --- NO PROTEST RECOMMENDED
const Tran = {
  caseNum: 'OA-0030', name: 'Tung Tran', county: 'Fulton',
  marketValue: 98880, medV: 235890, diff: -137010, diffPct: '-138.6%', status: 'DO NOT FILE',
  notes: 'Subject property is land-only assessed at $98,880 (40% FMV). Comparables with improvements assess significantly higher ($172K - $508K). The current data does not support a reduction and indicates potential under-assessment.'
};

function generateReviewMemo(client) {
  let memo = `\nDear ${client.name.split(' ')[0]},

This memo summarizes our analysis for your property tax protest at ${client.address} (${client.county}, ${client.state}).\n\n**Current Status:** ${client.status}\n\n`;

  if (client.status === 'DO NOT FILE') {
    memo += `**Reasoning:**\nBased on the available market data and current property assessment (${cur(client.marketValue)}), we cannot recommend filing a protest at this time. The comparable sales analysis indicates that the subject property's value is currently assessed at or below the market rate. Our analysis resulted in an indicated value of ${client.medV ? cur(client.medV) : 'N/A'} \n\n${client.notes}\n\nWe recommend reassessing this in the future if market conditions change or new data becomes available.\n`;
  } else {
    memo += `**Analysis Summary:**\n- Current Appraised Value: ${cur(client.marketValue)}\n- Indicated Value from Comps: ${cur(client.medV)} (${client.diffPct}% difference)\n- ${client.diff < 0 ? 'Potential Reduction: ' + cur(client.diff) : 'Potential Increase: ' + cur(client.diff)}\n\n**Recommendation:** File Protest. The evidence strongly supports a reduction in your property\'s assessed value.\n\n${client.notes}\n`;
  }
  memo += '\nSincerely,\nAquaBot (Worthey Aquatics)`;
  return memo;
}

async function main() {
  console.log('=== Generating Client Review Memos ===');

  // Generate memos for Matthews and Tran
  const matthewsMemo = generateReviewMemo(Matthews);
  const tranMemo = generateReviewMemo(Tran);

  console.log('\n--- MEMO FOR JASON MATTHEWS (OA-0022) ---');
  console.log(matthewsMemo);
  await fs.promises.writeFile(
    '/Users/aquabot/Documents/OverAssessed/memos/OA-0022_Matthews_Review.txt',
    matthewsMemo
  );

  console.log('\n--- MEMO FOR TUNG TRAN (OA-0030) ---');
  console.log(tranMemo);
  await fs.promises.writeFile(
    '/Users/aquabot/Documents/OverAssessed/memos/OA-0030_Tran_Review.txt',
    tranMemo
  );

  console.log('\n=== FINAL REVIEW BUNDLE ===');
  console.log('| Case | Name | County | Current value | Indicated value | Status | Recommended action |');
  console.log('|------|------|--------|---------------|-----------------|--------|--------------------|');
  [Rupani, Matthews, Runyon, Dickinson, Tran].forEach(c => {
    console.log(`| ${c.caseNum} | ${c.name} | ${c.county} | ${cur(c.marketValue)} | ${cur(c.medV)} | ${c.status} | ${c.status === 'READY' ? 'File Protest' : 'Do Not File / Reassess Later'} |`);
  });

  console.log('\n=== DONE ===');
}

main();
