#!/usr/bin/env node
/**
 * TX Protest Package Builder — Batch Run
 * Generates TaxNet-format protest packages for all TX cases.
 * 
 * Priority 1: OA-0025, OA-0084, OA-0022 (notice + comps)
 * Priority 2: Cases with comps but no notice
 * Priority 3: Cases needing comps (Rentcast fetch)
 */

require('dotenv').config({ path: require('path').join(__dirname, 'server/.env') });
const { createClient } = require('@supabase/supabase-js');

// Load services from project
const { generateTaxNetPackage } = require('./server/services/taxnet-package-generator');
const { getAVM } = require('./server/services/rentcast');

const fs = require('fs');
const path = require('path');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const OUT_DIR = '/tmp/tx-packages';
const RESULTS_FILE = '/tmp/tx-package-results.json';
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Priority order — exactly as specified
const PRIORITY_1 = ['OA-0025', 'OA-0084', 'OA-0022'];
const PRIORITY_2 = ['OA-0015','OA-0016','OA-0018','OA-0021','OA-0023','OA-0024','OA-0033','OA-0042','OA-0045','OA-0076','OA-0079','OA-0066','OA-0027'];
const PRIORITY_3 = ['OA-0003','OA-0004','OA-0007','OA-0010','OA-0011','OA-0013','OA-0020','OA-0034','OA-0035','OA-0043','OA-0053','OA-0063','OA-0067','OA-0070'];
const ALL_CASES = [...PRIORITY_1, ...PRIORITY_2, ...PRIORITY_3];

// ── Helpers ──────────────────────────────────────────────

function parseAV(val) {
    if (!val) return 0;
    return parseInt(String(val).replace(/[\$,\s]/g, '')) || 0;
}

function conditionToScore(cond) {
    const c = (cond || '').toLowerCase();
    if (c.includes('excel')) return 5;
    if (c.includes('good'))  return 4;
    if (c.includes('average') || c.includes('avg')) return 3;
    if (c.includes('fair'))  return 2;
    if (c.includes('poor'))  return 1;
    return 3;
}

function parseAcres(lotSizeStr, lotSizeSqft) {
    if (lotSizeStr) {
        const m = String(lotSizeStr).match(/([\d.]+)\s*acres?/i);
        if (m) return parseFloat(m[1]);
        const sqft = parseFloat(String(lotSizeStr).replace(/[^\d.]/g,''));
        if (!isNaN(sqft) && sqft > 1000) return sqft / 43560;
    }
    if (lotSizeSqft && lotSizeSqft > 100) return lotSizeSqft / 43560;
    return 0;
}

function mapDbComp(comp) {
    const mv = comp.marketValue || comp._mv || 0;
    const land = comp.landValue || 0;
    return {
        propId:         comp.parcelId || '',
        address:        (comp.address || '').trim(),
        marketValue:    mv,
        sqft:           comp.sqft || 0,
        yearBuilt:      comp.yearBuilt || comp._yr || 0,
        effectiveYear:  comp.effectiveYear || comp.yearBuilt || comp._yr || 0,
        distance:       comp.distance != null ? comp.distance : 0.5,
        propClass:      (comp.propertyClass || 'A1').replace('Residential','A1'),
        conditionLabel: comp.condition || 'Average',
        conditionScore: conditionToScore(comp.condition),
        landValue:      land,
        improvValue:    Math.max(0, mv - land),
        featureValue:   0,
        poolValue:      0,
        source:         'cad'
    };
}

function mapRentcastComp(comp) {
    const mv = comp.price || comp.lastSalePrice || 0;
    return {
        propId:         '',
        address:        (comp.formattedAddress || comp.address || '').trim(),
        marketValue:    mv,
        sqft:           comp.squareFootage || 0,
        yearBuilt:      comp.yearBuilt || 0,
        effectiveYear:  comp.yearBuilt || 0,
        distance:       comp.distance != null ? comp.distance : 0.5,
        propClass:      'A1',
        conditionLabel: 'Average',
        conditionScore: 3,
        landValue:      0,
        improvValue:    mv,
        featureValue:   0,
        poolValue:      0,
        source:         'rentcast'
    };
}

const EXCLUDED_TYPES = ['manufactured', 'mobile', 'modular', 'land', 'vacant', 'commercial'];

async function getRentcastComps(address) {
    try {
        const avmData = await getAVM(address);
        if (!avmData || !avmData.comparables) return [];
        return avmData.comparables
            .filter(c => {
                const pt = (c.propertyType || '').toLowerCase();
                return !EXCLUDED_TYPES.some(x => pt.includes(x));
            })
            .map(mapRentcastComp)
            .filter(c => c.marketValue > 0 && c.address);
    } catch (e) {
        console.log(`  [Rentcast] Error: ${e.message}`);
        return [];
    }
}

// ── Per-Case Processor ────────────────────────────────────

async function processCase(row) {
    const caseId = row.case_id;
    const av = parseAV(row.assessed_value);
    const pd = row.property_data || {};
    
    // Resolve sqft from multiple sources
    const sqft = row.sqft || pd.sqft || 0;
    const yearBuilt = row.year_built || pd.year_built || pd.yearBuilt || 0;
    const landValue = pd.land_value || pd.landValue || 0;
    const lotSize = parseAcres(pd.lot_size || row.lot_size, pd.lot_sqft);
    
    // Best-effort opinion of value
    const opinionValue = row.comp_results?.medianAdjustedValue
        || row.comp_results?.estimated_value
        || (av && row.estimated_savings ? av - (row.estimated_savings || 0) : 0)
        || Math.round(av * 0.85);

    console.log(`\n${'─'.repeat(64)}`);
    console.log(`${caseId} | ${(row.owner_name||'').trim()} | ${row.county} | AV $${av.toLocaleString()} | sqft ${sqft}`);

    // ── Build subject ──
    const subject = {
        address:          row.property_address,
        accountId:        pd.pidn || pd.accountId || pd.prop_id || '',
        geoId:            pd.geo_id || '',
        legalDescription: pd.legal_desc || pd.legalDescription || pd.LegalDesc || '',
        assessedValue:    av,
        opinionOfValue:   opinionValue,
        sqft:             sqft,
        yearBuilt:        yearBuilt,
        effectiveYear:    yearBuilt,
        landValue:        landValue,
        improvementValue: Math.max(0, av - landValue),
        conditionScore:   row.condition_issues ? 2 : 3,
        conditionLabel:   row.condition_issues ? 'Fair' : 'Average',
        propClass:        pd.class || 'A1',
        ownerName:        (row.owner_name || '').trim(),
        county:           row.county,
        acres:            lotSize || 0,
        featureValue:     0,
        poolValue:        pd.pool ? 15000 : 0
    };

    if (!subject.assessedValue) {
        console.log('  ❌ BLOCKED: No assessed value');
        return { case_id: caseId, owner: (row.owner_name||'').trim(), county: row.county, av, est_savings: 0, status: 'BLOCKED', what_is_missing: 'no_assessed_value' };
    }

    // ── Get comps ──
    const rawDbComps = (row.comp_results?.comps || []).filter(c => (c.marketValue || c._mv) > 0);
    let dbComps = rawDbComps.map(mapDbComp);
    console.log(`  DB comps: ${dbComps.length}`);

    let rentcastComps = [];
    if (dbComps.length < 8) {
        const needed = 8 - dbComps.length;
        console.log(`  Fetching Rentcast comps (need ${needed} more for ${row.property_address})...`);
        rentcastComps = await getRentcastComps(row.property_address);
        console.log(`  Rentcast returned: ${rentcastComps.length} comps`);
    }

    // Deduplicate by address prefix
    const dbAddrs = new Set(dbComps.map(c => c.address.toLowerCase().replace(/[^a-z0-9]/g,'').substring(0,12)));
    const uniqueRentcast = rentcastComps.filter(c => {
        const key = c.address.toLowerCase().replace(/[^a-z0-9]/g,'').substring(0,12);
        return key && !dbAddrs.has(key);
    });

    const allComps = [...dbComps, ...uniqueRentcast];
    console.log(`  Total comps: ${allComps.length} (${dbComps.length} CAD + ${uniqueRentcast.length} Rentcast)`);

    if (allComps.length === 0) {
        console.log('  ❌ MISSING_COMPS: 0 comps available');
        return { case_id: caseId, owner: (row.owner_name||'').trim(), county: row.county, av, est_savings: row.estimated_savings || 0, status: 'MISSING', what_is_missing: 'no_comps_db_or_rentcast' };
    }

    if (allComps.length < 3) {
        console.log(`  ❌ MISSING_COMPS: only ${allComps.length} comp(s)`);
        return { case_id: caseId, owner: (row.owner_name||'').trim(), county: row.county, av, est_savings: row.estimated_savings || 0, status: 'MISSING', what_is_missing: `only_${allComps.length}_comps` };
    }

    // ── Build caseData ──
    const caseData = {
        case_id:          caseId,
        owner_name:       (row.owner_name || '').trim(),
        county:           row.county,
        phone:            row.phone || '',
        email:            row.email || '',
        property_address: row.property_address
    };

    // ── Generate package ──
    let result;
    try {
        result = await generateTaxNetPackage(caseData, subject, allComps);
    } catch (e) {
        console.log(`  ❌ generateTaxNetPackage error: ${e.message}`);
        return { case_id: caseId, owner: (row.owner_name||'').trim(), county: row.county, av, est_savings: row.estimated_savings || 0, status: 'BLOCKED', what_is_missing: e.message.substring(0, 100) };
    }

    // ── Save PDF to output dir ──
    const outPath = path.join(OUT_DIR, `${caseId}-protest-package.pdf`);
    fs.copyFileSync(result.filePath, outPath);
    const pdfSize = fs.statSync(outPath).size;
    console.log(`  ✅ PDF: ${outPath} (${(pdfSize/1024).toFixed(0)}KB, ${allComps.length} comps, median $${result.stats.median.toLocaleString()})`);

    // ── Upload to Supabase storage ──
    const storagePath = `protest-packages/${caseId}.pdf`;
    const pdfBuf = fs.readFileSync(outPath);
    const { error: upErr } = await sb.storage.from('documents').upload(storagePath, pdfBuf, {
        contentType: 'application/pdf', upsert: true
    });

    if (upErr) {
        console.log(`  ⚠️ Storage upload failed: ${upErr.message}`);
        return {
            case_id: caseId, owner: (row.owner_name||'').trim(), county: row.county,
            av, est_savings: Math.max(0, av - result.stats.median),
            status: 'READY', what_is_missing: 'upload_failed: ' + upErr.message
        };
    }

    console.log(`  📤 Uploaded: documents/${storagePath}`);

    // ── Update submissions row ──
    const { error: dbErr } = await sb.from('submissions').update({
        evidence_packet_path: storagePath,
        updated_at: new Date().toISOString()
    }).eq('case_id', caseId);

    if (dbErr) console.log(`  ⚠️ DB update error: ${dbErr.message}`);
    else console.log(`  💾 DB updated: evidence_packet_path = ${storagePath}`);

    const estSavings = av - result.stats.median;
    return {
        case_id: caseId,
        owner:   (row.owner_name||'').trim(),
        county:  row.county,
        av,
        est_savings: estSavings > 0 ? estSavings : (row.estimated_savings || 0),
        status:  'READY',
        what_is_missing: ''
    };
}

// ── Main ──────────────────────────────────────────────────

async function main() {
    console.log('=== TX PROTEST PACKAGE BUILDER ===');
    console.log(`Target: ${ALL_CASES.length} cases`);
    console.log(`Output: ${OUT_DIR}`);
    console.log('');

    // Fetch all rows in one query
    const { data: rows, error: fetchErr } = await sb.from('submissions')
        .select(`
            case_id, owner_name, county, assessed_value, sqft, year_built, lot_size,
            property_address, property_data, comp_results, estimated_savings,
            phone, email, condition_issues, notice_url, notice_of_value
        `)
        .in('case_id', ALL_CASES)
        .is('deleted_at', null);

    if (fetchErr) { console.error('DB fetch failed:', fetchErr); process.exit(1); }

    const byId = Object.fromEntries(rows.map(r => [r.case_id, r]));
    const ordered = ALL_CASES
        .filter(id => {
            if (!byId[id]) { console.log(`WARN: ${id} not found in DB`); return false; }
            return true;
        })
        .map(id => byId[id]);

    console.log(`Loaded ${ordered.length} records\n`);

    const results = [];
    for (const row of ordered) {
        try {
            const r = await processCase(row);
            results.push(r);
        } catch (e) {
            console.error(`FATAL for ${row.case_id}:`, e.message, e.stack);
            results.push({
                case_id: row.case_id,
                owner:   (row.owner_name||'').trim(),
                county:  row.county,
                av:      parseAV(row.assessed_value),
                est_savings: 0,
                status:  'BLOCKED',
                what_is_missing: 'fatal: ' + e.message.substring(0, 80)
            });
        }
        // Pause between cases to respect Rentcast rate limits
        await new Promise(r => setTimeout(r, 600));
    }

    // ── Write results JSON ──
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
    console.log(`\n✅ Results written to ${RESULTS_FILE}`);

    // ── Print summary table ──
    const COL = [12, 25, 12, 12, 14, 9, 50];
    const HDR = ['case_id','owner','county','AV','est_savings','status','what_is_missing'];
    const SEP = '─'.repeat(COL.reduce((a,b)=>a+b,0)+HDR.length*3);
    console.log('\n' + SEP);
    console.log(HDR.map((v,i)=>v.padEnd(COL[i])).join(' | '));
    console.log(SEP);
    for (const r of results) {
        const cols = [
            (r.case_id||'').padEnd(COL[0]),
            ((r.owner||'').substring(0,24)).padEnd(COL[1]),
            ((r.county||'').substring(0,11)).padEnd(COL[2]),
            ('$'+(r.av||0).toLocaleString()).padStart(COL[3]),
            ('$'+(r.est_savings||0).toLocaleString()).padStart(COL[4]),
            (r.status||'').padEnd(COL[5]),
            (r.what_is_missing||'').substring(0,48)
        ];
        console.log(cols.join(' | '));
    }

    const ready   = results.filter(r => r.status === 'READY').length;
    const missing = results.filter(r => r.status === 'MISSING').length;
    const blocked = results.filter(r => r.status === 'BLOCKED').length;
    console.log(`\n${SEP}`);
    console.log(`TOTALS: ${ready} READY  |  ${missing} MISSING  |  ${blocked} BLOCKED  |  ${results.length} total`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
