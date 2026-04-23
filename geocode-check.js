process.chdir('/Users/aquabot/Documents/OverAssessed');
require('dotenv').config();
const { geocode } = require('./server/services/map-generator');

const subject = { label: 'SUBJECT', address: '24209 Scenic Loop Rd, San Antonio, TX 78255' };
const comps = [
  { num: 1, address: '18211 Scenic Loop Rd, San Antonio, TX 78255' },
  { num: 2, address: '21985 Scenic Loop Rd, San Antonio, TX 78255' },
  { num: 3, address: '24210 Scenic Loop Rd, San Antonio, TX 78255' },
  { num: 4, address: '20619 Helotes Creek Rd, San Antonio, TX 78255' },
  { num: 5, address: '20111 Helotes Creek Rd, San Antonio, TX 78255' },
  { num: 6, address: '20105 Helotes Creek Rd, San Antonio, TX 78255' },
  { num: 7, address: '20616 Helotes Creek Rd, San Antonio, TX 78255' },
  { num: 8, address: '20609 Helotes Creek Rd, San Antonio, TX 78255' },
  { num: 9, address: '20610 Helotes Creek Rd, San Antonio, TX 78255' },
  { num: 10, address: '44 Boerne Stage Airfield, San Antonio, TX 78255' },
];

(async () => {
  // Geocode subject
  const sg = await geocode(subject.address);
  console.log(`SUBJECT | ${subject.address} | lat=${sg ? sg.lat : 'FAILED'} | lon=${sg ? sg.lon : 'FAILED'}`);

  const results = [];
  for (const c of comps) {
    const g = await geocode(c.address);
    const lat = g ? g.lat : null;
    const lon = g ? g.lon : null;
    results.push({ num: c.num, address: c.address, lat, lon });
    console.log(`Comp ${c.num} | ${c.address} | lat=${lat || 'FAILED'} | lon=${lon || 'FAILED'}`);
  }

  // Check for duplicates
  console.log('\n=== DUPLICATE CHECK ===');
  const coordMap = {};
  for (const r of results) {
    if (!r.lat) continue;
    const key = `${r.lat.toFixed(4)},${r.lon.toFixed(4)}`;
    if (!coordMap[key]) coordMap[key] = [];
    coordMap[key].push(r.num);
  }
  for (const [key, nums] of Object.entries(coordMap)) {
    if (nums.length > 1) console.log(`DUPLICATE at ${key}: comps ${nums.join(', ')}`);
    else console.log(`OK ${key}: comp ${nums[0]}`);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
