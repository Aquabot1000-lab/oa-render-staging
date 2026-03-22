/**
 * Generic Local CAD Data Adapter
 * Works for any county with a parcels-compact.jsonl.gz file.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');

class LocalCADData {
  constructor(countyName, dataPath) {
    this.countyName = countyName;
    this.dataPath = dataPath;
    this.accountIndex = null;
    this.loaded = false;
    this.loading = false;
    this.recordCount = 0;
  }

  async loadData() {
    if (this.loaded || this.loading) return;
    this.loading = true;
    
    if (!fs.existsSync(this.dataPath)) {
      console.warn('[LocalCAD:' + this.countyName + '] Data file not found: ' + this.dataPath);
      this.loading = false;
      return;
    }
    
    console.log('[LocalCAD:' + this.countyName + '] Loading from ' + this.dataPath + '...');
    const start = Date.now();
    this.accountIndex = new Map();
    
    const isGz = this.dataPath.endsWith('.gz');
    const fileStream = fs.createReadStream(this.dataPath);
    const inputStream = isGz ? fileStream.pipe(zlib.createGunzip()) : fileStream;
    const rl = readline.createInterface({ input: inputStream, crlfDelay: Infinity });
    
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec.a) this.accountIndex.set(rec.a, rec);
      } catch(e) { /* skip bad lines */ }
    }
    
    this.recordCount = this.accountIndex.size;
    this.loaded = true;
    this.loading = false;
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log('[LocalCAD:' + this.countyName + '] Loaded ' + this.recordCount.toLocaleString() + ' parcels in ' + elapsed + 's');
  }

  isLoaded() { return this.loaded; }

  searchByAddress(query, limit) {
    limit = limit || 10;
    if (!this.loaded) return [];
    const q = (query || '').toUpperCase().replace(/[^A-Z0-9\s]/g, '').trim();
    if (!q || q.length < 3) return [];
    
    const results = [];
    for (const [, rec] of this.accountIndex) {
      if ((rec.s || '').includes(q)) {
        results.push(this._expand(rec));
        if (results.length >= limit) break;
      }
    }
    
    // Fuzzy: strip suffix if no results
    if (results.length === 0) {
      const stripped = q.replace(/\s+(DR|LN|AVE|ST|CT|RD|BLVD|WAY|TRL|CIR|PL|LOOP|PKWY|DRIVE|LANE|AVENUE|STREET|COURT|ROAD|BOULEVARD|TRAIL|CIRCLE|PLACE)\.?$/i, '');
      if (stripped !== q) {
        for (const [, rec] of this.accountIndex) {
          if ((rec.s || '').includes(stripped)) {
            results.push(this._expand(rec));
            if (results.length >= limit) break;
          }
        }
      }
    }
    return results;
  }

  lookupAccount(accountId) {
    if (!this.loaded) return null;
    const rec = this.accountIndex.get(accountId);
    return rec ? this._expand(rec) : null;
  }

  _expand(r) {
    return {
      accountNumber: r.a,
      address: r.s,
      propertyClass: r.c,
      appraisedValue: r.av || r.tv,
      totalValue: r.tv,
      landValue: r.lv,
      improvementValue: r.iv,
      sqft: r.sf,
      yearBuilt: r.yb,
      bedrooms: r.bd,
      bathrooms: r.ba,
      hasPool: r.pl === 1,
      garageCap: r.gc,
      legalDescription: r.ld,
      zipCode: r.z
    };
  }
}

module.exports = { LocalCADData };
