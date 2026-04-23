/**
 * Map Generator — OSM tile stitcher with markers
 * Produces a PNG buffer suitable for embedding in PDFs.
 * No API key required — uses OpenStreetMap tile servers.
 */

const axios = require('axios');
const { PNG } = require('pngjs');
const fs = require('fs');

const USER_AGENT = 'OverAssessed/1.0 (tyler@overassessed.ai)';
const TILE_SIZE = 256;

// Lat/lon → tile x/y at zoom level
function latLonToTile(lat, lon, zoom) {
    const n = Math.pow(2, zoom);
    const x = Math.floor((lon + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x, y };
}

// Lat/lon → pixel position within a stitched image
function latLonToPixel(lat, lon, zoom, originTileX, originTileY) {
    const n = Math.pow(2, zoom);
    const px = ((lon + 180) / 360 * n - originTileX) * TILE_SIZE;
    const latRad = lat * Math.PI / 180;
    const py = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n - originTileY) * TILE_SIZE;
    return { px: Math.round(px), py: Math.round(py) };
}

async function fetchTile(z, x, y, retries = 2) {
    const servers = ['a', 'b', 'c'];
    const s = servers[Math.abs(x + y) % 3];
    const url = `https://${s}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
    for (let i = 0; i <= retries; i++) {
        try {
            const r = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 10000,
                headers: { 'User-Agent': USER_AGENT }
            });
            return Buffer.from(r.data);
        } catch (e) {
            if (i === retries) throw new Error(`Tile ${z}/${x}/${y} failed: ${e.message}`);
            await new Promise(r => setTimeout(r, 500));
        }
    }
}

function parsePNG(buf) {
    return new Promise((res, rej) => {
        const png = new PNG();
        png.parse(buf, (err, data) => err ? rej(err) : res(data));
    });
}

// Draw a filled circle marker on PNG data
function drawCircle(png, cx, cy, radius, r, g, b, a = 255) {
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            if (dx * dx + dy * dy <= radius * radius) {
                const px = cx + dx, py = cy + dy;
                if (px >= 0 && px < png.width && py >= 0 && py < png.height) {
                    const idx = (py * png.width + px) * 4;
                    png.data[idx] = r;
                    png.data[idx + 1] = g;
                    png.data[idx + 2] = b;
                    png.data[idx + 3] = a;
                }
            }
        }
    }
}

// Draw circle border
function drawCircleBorder(png, cx, cy, radius, thickness, r, g, b) {
    for (let dy = -(radius + thickness); dy <= (radius + thickness); dy++) {
        for (let dx = -(radius + thickness); dx <= (radius + thickness); dx++) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist >= radius && dist <= radius + thickness) {
                const px = cx + dx, py = cy + dy;
                if (px >= 0 && px < png.width && py >= 0 && py < png.height) {
                    const idx = (py * png.width + px) * 4;
                    png.data[idx] = r;
                    png.data[idx + 1] = g;
                    png.data[idx + 2] = b;
                    png.data[idx + 3] = 255;
                }
            }
        }
    }
}

// Draw a pin (teardrop shape) pointing down
function drawPin(png, cx, cy, r, g, b) {
    // Body circle
    drawCircle(png, cx, cy - 8, 10, r, g, b);
    drawCircleBorder(png, cx, cy - 8, 10, 2, 255, 255, 255);
    // Tail triangle pointing down
    for (let i = 0; i <= 8; i++) {
        const w = Math.round((8 - i) * 0.6);
        for (let dx = -w; dx <= w; dx++) {
            const px = cx + dx, py = cy - i;
            if (px >= 0 && px < png.width && py >= 0 && py < png.height) {
                const idx = (py * png.width + px) * 4;
                png.data[idx] = r;
                png.data[idx + 1] = g;
                png.data[idx + 2] = b;
                png.data[idx + 3] = 255;
            }
        }
    }
    // White center dot
    drawCircle(png, cx, cy - 8, 4, 255, 255, 255);
}

// Minimal 3x5 pixel bitmap font for digits 0-9
const DIGIT_BITMAPS = {
  '0': [0b111,0b101,0b101,0b101,0b111],
  '1': [0b010,0b110,0b010,0b010,0b111],
  '2': [0b111,0b001,0b111,0b100,0b111],
  '3': [0b111,0b001,0b111,0b001,0b111],
  '4': [0b101,0b101,0b111,0b001,0b001],
  '5': [0b111,0b100,0b111,0b001,0b111],
  '6': [0b111,0b100,0b111,0b101,0b111],
  '7': [0b111,0b001,0b011,0b010,0b010],
  '8': [0b111,0b101,0b111,0b101,0b111],
  '9': [0b111,0b101,0b111,0b001,0b111],
};

function drawDigits(png, x, y, text, r, g, b) {
    let cx = x;
    for (const ch of text) {
        const bm = DIGIT_BITMAPS[ch];
        if (!bm) { cx += 4; continue; }
        for (let row = 0; row < 5; row++) {
            for (let col = 0; col < 3; col++) {
                if (bm[row] & (0b100 >> col)) {
                    const px = cx + col, py = y + row;
                    if (px >= 0 && px < png.width && py >= 0 && py < png.height) {
                        const idx = (py * png.width + px) * 4;
                        png.data[idx] = r; png.data[idx+1] = g; png.data[idx+2] = b; png.data[idx+3] = 255;
                    }
                }
            }
        }
        cx += 4;
    }
}

/**
 * Generate a stitched map PNG buffer.
 * @param {number} centerLat
 * @param {number} centerLon
 * @param {number} zoom - OSM zoom level (12-16)
 * @param {number} tilesWide - number of tiles wide
 * @param {number} tilesHigh - number of tiles tall
 * @param {Array} markers - [{lat, lon, color: [r,g,b], label}]
 */
async function generateMapImage(centerLat, centerLon, zoom, tilesWide, tilesHigh, markers = []) {
    const centerTile = latLonToTile(centerLat, centerLon, zoom);
    const originX = centerTile.x - Math.floor(tilesWide / 2);
    const originY = centerTile.y - Math.floor(tilesHigh / 2);

    const imgW = tilesWide * TILE_SIZE;
    const imgH = tilesHigh * TILE_SIZE;

    // Create blank PNG
    const out = new PNG({ width: imgW, height: imgH, filterType: -1 });
    out.data.fill(200); // light gray background

    // Fetch and blit all tiles
    const tilePromises = [];
    for (let ty = 0; ty < tilesHigh; ty++) {
        for (let tx = 0; tx < tilesWide; tx++) {
            tilePromises.push(
                fetchTile(zoom, originX + tx, originY + ty)
                    .then(buf => parsePNG(buf))
                    .then(tile => ({ tile, tx, ty }))
                    .catch(() => null)
            );
        }
    }

    const tiles = await Promise.all(tilePromises);
    for (const t of tiles) {
        if (!t) continue;
        const { tile, tx, ty } = t;
        const offsetX = tx * TILE_SIZE;
        const offsetY = ty * TILE_SIZE;
        for (let py = 0; py < tile.height; py++) {
            for (let px = 0; px < tile.width; px++) {
                const srcIdx = (py * tile.width + px) * 4;
                const dstIdx = ((offsetY + py) * imgW + (offsetX + px)) * 4;
                out.data[dstIdx] = tile.data[srcIdx];
                out.data[dstIdx + 1] = tile.data[srcIdx + 1];
                out.data[dstIdx + 2] = tile.data[srcIdx + 2];
                out.data[dstIdx + 3] = tile.data[srcIdx + 3];
            }
        }
    }

    // Draw markers — dedup stacked markers with pixel offset, draw numbered labels
    const usedPixels = {};
    for (const m of markers) {
        let { px, py } = latLonToPixel(m.lat, m.lon, zoom, originX, originY);
        // Offset stacked markers (within 12px)
        const baseKey = `${Math.round(px / 12)},${Math.round(py / 12)}`;
        if (!usedPixels[baseKey]) usedPixels[baseKey] = 0;
        const offset = usedPixels[baseKey];
        usedPixels[baseKey]++;
        if (offset > 0) {
            // Spiral offset: 0=none, 1=right, 2=down, 3=left, 4=up, 5=right+down...
            const offsets = [[0,0],[14,0],[0,14],[-14,0],[0,-14],[14,14],[-14,14],[14,-14],[-14,-14],[20,0]];
            const o = offsets[Math.min(offset, offsets.length - 1)];
            px += o[0]; py += o[1];
        }
        const [r, g, b] = m.color || [220, 50, 50];
        drawPin(out, px, py, r, g, b);
        // Draw number label if provided
        if (m.label) {
            // Simple white background box then dark text (pixel font approximation)
            const lx = px + 7, ly = py - 22;
            // White bg
            for (let dy = -2; dy <= 8; dy++) {
                for (let dx = -1; dx <= 7; dx++) {
                    const ppx = lx + dx, ppy = ly + dy;
                    if (ppx >= 0 && ppx < out.width && ppy >= 0 && ppy < out.height) {
                        const idx = (ppy * out.width + ppx) * 4;
                        out.data[idx] = 255; out.data[idx+1] = 255; out.data[idx+2] = 255; out.data[idx+3] = 220;
                    }
                }
            }
            // Draw digits using a minimal 3x5 bitmap font
            drawDigits(out, lx, ly, String(m.label), r, g, b);
        }
    }

    // Encode to PNG buffer
    return new Promise((res, rej) => {
        const chunks = [];
        out.pack().on('data', c => chunks.push(c)).on('end', () => res(Buffer.concat(chunks))).on('error', rej);
    });
}

/**
 * Geocode an address — tries Nominatim first, falls back to US Census Bureau geocoder.
 */
async function geocode(address) {
    // 1. Try Nominatim
    try {
        const r = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: { q: address, format: 'json', limit: 1, countrycodes: 'us' },
            headers: { 'User-Agent': USER_AGENT },
            timeout: 8000
        });
        if (r.data && r.data[0]) {
            return { lat: parseFloat(r.data[0].lat), lon: parseFloat(r.data[0].lon) };
        }
    } catch (e) { /* fall through */ }

    // 2. Fallback: US Census Bureau Geocoder (no API key, handles TX parcel addresses well)
    try {
        const encoded = encodeURIComponent(address);
        const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encoded}&benchmark=Public_AR_Current&format=json`;
        const r = await axios.get(url, { timeout: 10000 });
        const match = r.data?.result?.addressMatches?.[0]?.coordinates;
        if (match) {
            return { lat: parseFloat(match.y), lon: parseFloat(match.x) };
        }
    } catch (e) { /* fall through */ }

    return null;
}

module.exports = { generateMapImage, geocode, latLonToTile, latLonToPixel };
