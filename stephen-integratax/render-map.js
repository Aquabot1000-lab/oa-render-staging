const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Generate a static map image using Leaflet + OSM tiles
// Subject: 3125 Overton Park Dr E, Fort Worth (Tanglewood)
// Lat/Lng: 32.7330, -97.3820

async function renderMap() {
  const mapHtml = `<!DOCTYPE html>
<html><head>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>body{margin:0}#map{width:900px;height:500px}</style>
</head><body>
<div id="map"></div>
<script>
const map = L.map('map', {zoomControl:false}).setView([32.733, -97.382], 15);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '© CartoDB © OpenStreetMap'
}).addTo(map);

// Subject marker (red)
const subjectIcon = L.divIcon({
  html: '<div style="background:#6c5ce7;color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:14px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);">S</div>',
  className: '',
  iconSize: [28, 28],
  iconAnchor: [14, 14]
});
L.marker([32.733, -97.382], {icon: subjectIcon}).addTo(map)
  .bindTooltip('Subject: 3125 Overton Park Dr E', {permanent: true, direction: 'top', offset: [0, -16]});

// Sample comp markers (blue, numbered) — spread around Tanglewood
const comps = [
  [32.735, -97.380, 1], [32.731, -97.384, 2], [32.734, -97.386, 3],
  [32.730, -97.381, 4], [32.736, -97.378, 5], [32.732, -97.376, 6],
  [32.729, -97.383, 7], [32.733, -97.388, 8], [32.737, -97.382, 9],
  [32.731, -97.378, 10], [32.735, -97.385, 11], [32.728, -97.380, 12],
  [32.734, -97.375, 13], [32.730, -97.386, 14], [32.736, -97.384, 15]
];

comps.forEach(([lat, lng, num]) => {
  const icon = L.divIcon({
    html: '<div style="background:#0984e3;color:white;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:10px;border:1.5px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.2);">' + num + '</div>',
    className: '',
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });
  L.marker([lat, lng], {icon: icon}).addTo(map);
});
</script>
</body></html>`;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 900, height: 500 });
  await page.setContent(mapHtml, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000); // Wait for tiles to load
  
  const mapPath = path.join(__dirname, 'subject-map.png');
  await page.screenshot({ path: mapPath });
  await browser.close();
  
  console.log('✅ Map screenshot saved:', mapPath);
  return mapPath;
}

renderMap().catch(console.error);
