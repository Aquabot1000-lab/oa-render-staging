const fs = require('fs');
const PDFDocument = require('pdfkit');
const path = require('path');

function s(v) { return (v == null) ? '-' : String(v); }
function cur(v) { if (v == null) return '-'; const n = Number(v); return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US'); }

const clients = [
  {
    name: 'Shabir Hasanali Rupani', caseNum: 'OA-0013',
    address: '708 SANTA LUCIA DR', fullAddress: '708 Santa Lucia Dr, Anna, TX 75409',
    county: 'Collin', taxId: 'R-13273-00J-0230-1', owner: 'RUPANI, SHABIR HASANALI',
    marketValue: 399042, propertyClass: 'A1', condition: 'Good',
    yearBuilt: '2024', effectiveYear: '2024', mainSqft: 1781,
    improvementValue: 274042, featureValue: 0, poolValue: 0, landValue: 125000,
    comps: [
      { taxId: 'R-13273-00J-0250-1', address: '740 SANTA LUCIA DR', mv: 359000, dist: 0.05, cls: 'A1', cond: 'Good', yb: '2024', ey: '2024', sqft: 1777, iv: 234000, fv: 0, pv: 0, lv: 125000 },
      { taxId: 'R-13273-00K-0010-1', address: '901 PORTINA DR', mv: 367500, dist: 0.16, cls: 'A1', cond: 'Good', yb: '2024', ey: '2024', sqft: 1777, iv: 242500, fv: 0, pv: 0, lv: 125000 },
      { taxId: 'R-13273-00K-0040-1', address: '924 AMENDUNI LN', mv: 367900, dist: 0.20, cls: 'A1', cond: 'Good', yb: '2024', ey: '2024', sqft: 1777, iv: 242900, fv: 0, pv: 0, lv: 125000 },
      { taxId: 'R-13273-00J-0070-1', address: '221 SANTA LUCIA DR', mv: 375000, dist: 0.17, cls: 'A1', cond: 'Good', yb: '2023', ey: '2023', sqft: 1799, iv: 249000, fv: 0, pv: 0, lv: 126000 },
      { taxId: 'R-13273-00L-0050-1', address: '1309 RENATO DR', mv: 375000, dist: 0.24, cls: 'A1', cond: 'Good', yb: '2024', ey: '2024', sqft: 1799, iv: 249000, fv: 0, pv: 0, lv: 126000 },
      { taxId: 'R-13273-00F-0120-1', address: '601 PEMBERTON DR', mv: 349995, dist: 0.25, cls: 'A1', cond: 'Good', yb: '2018', ey: '2018', sqft: 1842, iv: 223995, fv: 0, pv: 0, lv: 126000 },
      { taxId: 'R-13273-00H-0080-1', address: '1988 HELMOKEN FALLS DR', mv: 310000, dist: 0.38, cls: 'A1', cond: 'Good', yb: '2005', ey: '2005', sqft: 1787, iv: 185000, fv: 0, pv: 0, lv: 125000 },
      { taxId: 'R-13273-00C-0030-1', address: '132 BIRDBROOK DR', mv: 317000, dist: 0.45, cls: 'A1', cond: 'Good', yb: '2006', ey: '2006', sqft: 1782, iv: 192000, fv: 0, pv: 0, lv: 125000 },
      { taxId: 'R-13273-00E-0100-1', address: '910 FULBOURNE DR', mv: 315000, dist: 0.53, cls: 'A1', cond: 'Good', yb: '2007', ey: '2007', sqft: 1760, iv: 190000, fv: 0, pv: 0, lv: 125000 },
      { taxId: 'R-13273-00L-0040-1', address: '1216 RENATO DR', mv: 420000, dist: 0.26, cls: 'A1', cond: 'Good', yb: '2024', ey: '2024', sqft: 1800, iv: 294000, fv: 0, pv: 0, lv: 126000 },
    ]
  },
  {
    name: 'Khiem Nguyen', caseNum: 'OA-0010',
    address: '3315 MARLENE MEADOW WAY', fullAddress: '3315 Marlene Meadow Way, Richmond, TX 77406',
    county: 'Fort Bend', taxId: '5296-09-002-0200-901', owner: 'NGUYEN, KHIEM DUC',
    marketValue: 648786, propertyClass: 'A1', condition: 'Good',
    yearBuilt: '2023', effectiveYear: '2023', mainSqft: 3718,
    improvementValue: 585736, featureValue: 0, poolValue: 0, landValue: 63050,
    comps: [
      { taxId: '5296-09-002-0140-901', address: '3202 MARLENE MEADOW WAY', mv: 739900, dist: 0.11, cls: 'A1', cond: 'Good', yb: '2023', ey: '2023', sqft: 3717, iv: 676850, fv: 0, pv: 0, lv: 63050 },
      { taxId: '5296-09-001-0080-901', address: '3306 WILLOW FIN WAY', mv: 645000, dist: 0.17, cls: 'A1', cond: 'Good', yb: '2022', ey: '2022', sqft: 3741, iv: 581950, fv: 0, pv: 0, lv: 63050 },
      { taxId: '5296-09-002-0170-901', address: '3215 MARLENE MEADOW WAY', mv: 630000, dist: 0.09, cls: 'A1', cond: 'Good', yb: '2023', ey: '2023', sqft: 3794, iv: 566950, fv: 0, pv: 0, lv: 63050 },
      { taxId: '5296-05-001-0120-901', address: '2111 S PECAN TRAIL DR', mv: 574000, dist: 1.26, cls: 'A1', cond: 'Good', yb: '2002', ey: '2002', sqft: 3866, iv: 510950, fv: 0, pv: 0, lv: 63050 },
      { taxId: '5296-08-003-0050-901', address: '4119 PEMBROOKE WAY', mv: 774999, dist: 1.29, cls: 'A1', cond: 'Good', yb: '2003', ey: '2003', sqft: 3895, iv: 711949, fv: 0, pv: 0, lv: 63050 },
      { taxId: '5296-05-001-0080-901', address: '2015 PECAN TRAIL DR', mv: 499000, dist: 1.35, cls: 'A1', cond: 'Good', yb: '1990', ey: '1990', sqft: 3968, iv: 435950, fv: 0, pv: 0, lv: 63050 },
      { taxId: '5296-04-002-0100-901', address: '2218 LANDSCAPE WAY', mv: 500000, dist: 1.57, cls: 'A1', cond: 'Good', yb: '1989', ey: '1989', sqft: 3269, iv: 436950, fv: 0, pv: 0, lv: 63050 },
      { taxId: '5296-06-001-0030-901', address: '3006 PECAN WAY CT', mv: 625000, dist: 1.05, cls: 'A1', cond: 'Good', yb: '1998', ey: '1998', sqft: 4723, iv: 561950, fv: 0, pv: 0, lv: 63050 },
      { taxId: '5296-10-001-0150-901', address: '8327 VALBURN DR', mv: 464998, dist: 1.49, cls: 'A1', cond: 'Good', yb: '2024', ey: '2024', sqft: 2989, iv: 401948, fv: 0, pv: 0, lv: 63050 },
      { taxId: '5296-05-002-0040-901', address: '2106 SHADE CREST DR', mv: 549000, dist: 1.26, cls: 'A1', cond: 'Good', yb: '1994', ey: '1994', sqft: 4031, iv: 485950, fv: 0, pv: 0, lv: 63050 },
    ]
  }
];

function calcAdj(subj, comp) {
  const cpf = comp.iv / comp.sqft;
  const sz = Math.round(cpf * (subj.mainSqft - comp.sqft) / 2);
  const age = Math.round(0.5 * ((parseInt(subj.effectiveYear) - parseInt(comp.ey)) / 100) * comp.mv);
  const land = subj.landValue - comp.lv;
  const feat = subj.featureValue - comp.fv;
  const pool = subj.poolValue - comp.pv;
  const net = sz + age + land + feat + pool;
  return { sz, age, land, feat, pool, net, total: comp.mv + net, psf: cpf };
}

function adjS(val, base) {
  return cur(val) + ' (' + (base ? (val/base*100).toFixed(2) : '0.00') + '%)';
}

function gen(client) {
  return new Promise((resolve, reject) => {
    // Use bufferPages so we can go back and add footers after all content
    const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 30, bufferPages: true });
    const fn = `${client.caseNum}_${client.name.replace(/ /g,'_')}_Equal_Uniform.pdf`;
    const fp = path.join('/tmp', fn);
    const ws = fs.createWriteStream(fp);
    doc.pipe(ws);

    const spf = client.improvementValue / client.mainSqft;
    const cd = client.comps.map(c => ({...c, ...calcAdj(client, c)}));
    cd.sort((a,b) => a.total - b.total);
    const mi = Math.floor(cd.length/2);
    const medV = cd[mi].total, minV = cd[0].total, maxV = cd[cd.length-1].total;

    const PW = 792, PH = 612, ML = 30; // letter landscape
    const CPP = 3;

    const rows = [
      { l: 'Tax ID', sv: ()=>client.taxId, cv: c=>c.taxId },
      { l: 'Address', sv: ()=>client.address, cv: c=>c.address },
      { l: 'Market Value', sv: ()=>cur(client.marketValue), cv: c=>cur(c.mv) },
      { l: 'Distance (Miles)', sv: ()=>'-', cv: c=>c.dist.toFixed(2) },
      { l: 'Property Class', sv: ()=>client.propertyClass, cv: c=>c.cls },
      { l: 'Condition', sv: ()=>client.condition, cv: c=>c.cond },
      { l: 'Year Built (Effective)', sv: ()=>`${client.yearBuilt} (${client.effectiveYear})`, cv: c=>`${c.yb} (${c.ey})` },
      { l: 'Main SQFT (PSF)', sv: ()=>`${client.mainSqft.toLocaleString()} ($${spf.toFixed(2)})`, cv: c=>`${c.sqft.toLocaleString()} ($${c.psf.toFixed(2)})` },
      { l: 'Improvement Value', sv: ()=>cur(client.improvementValue), cv: c=>cur(c.iv) },
      { l: 'Feature Value', sv: ()=>cur(client.featureValue), cv: c=>cur(c.fv) },
      { l: 'Pool Value', sv: ()=>cur(client.poolValue), cv: c=>cur(c.pv) },
      { l: 'Land Value', sv: ()=>cur(client.landValue), cv: c=>cur(c.lv) },
      { l: 'Feature / Pool Value', sv: ()=>`${cur(client.featureValue)} (${cur(client.poolValue)})`, cv: c=>`${cur(c.fv)} (${cur(c.pv)})` },
      { l: '---' },
      { l: 'Age Adjustment', sv: ()=>'-', cv: c=>adjS(c.age,c.mv), adj:true },
      { l: 'Size Adjustment', sv: ()=>'-', cv: c=>adjS(c.sz,c.mv), adj:true },
      { l: 'Land Adjustment', sv: ()=>'-', cv: c=>adjS(c.land,c.mv), adj:true },
      { l: 'Feature Adjustment', sv: ()=>'-', cv: c=>adjS(c.feat,c.mv), adj:true },
      { l: 'Pool Adjustment', sv: ()=>'-', cv: c=>adjS(c.pool,c.mv), adj:true },
      { l: 'Net Adjustment', sv: ()=>'-', cv: c=>adjS(c.net,c.mv), adj:true, bold:true },
      { l: '---' },
      { l: 'Total Adjusted Value', sv: ()=>'-', cv: c=>cur(c.total), tot:true },
    ];

    function drawCompPage(pcs) {
      const lw = 130;
      const dw = (PW - 60 - lw) / (pcs.length + 1);
      let y = ML;

      // Header bar
      doc.rect(ML, y, PW-60, 20).fill('#2c3e50');
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff')
         .text('OverAssessed.ai', ML+8, y+3, {width:150,height:10,lineBreak:false});
      doc.font('Helvetica').fontSize(6).fillColor('#ddd')
         .text(`${client.name}  |  ${client.county} County  |  ${client.caseNum}`, ML+8, y+12, {width:PW-100,height:8,lineBreak:false});
      y += 22;

      // Banner
      doc.rect(ML, y, PW-60, 14).fill('#34495e');
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff')
         .text('Equal & Uniform Analysis', ML, y+2, {width:PW-60,align:'center',height:12,lineBreak:false});
      y += 16;

      // Property line
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a2e')
         .text(`${client.address}    Tax ID: ${client.taxId}    Owner: ${client.owner}`, ML+5, y+1, {width:PW-70,height:12,lineBreak:false});
      y += 14;

      // Indicated value
      doc.rect(ML, y, 155, 16).fill('#e8f5e9').lineWidth(0.5).stroke('#2e7d32');
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#2e7d32')
         .text(`Indicated Value ${cur(medV)}`, ML+4, y+3, {width:150,height:12,lineBreak:false});
      doc.rect(ML+160, y, PW-60-160, 16).fill('#f5f5f5').lineWidth(0.5).stroke('#999');
      doc.font('Helvetica').fontSize(6).fillColor('#333')
         .text(`Comps: ${cd.length}  |  Min: ${cur(minV)}  |  Max: ${cur(maxV)}  |  Median: ${cur(medV)}`, ML+165, y+4, {width:PW-240,height:10,lineBreak:false});
      y += 20;

      // Column headers
      const rh = 14;
      doc.rect(ML, y, lw, 14).fill('#dee2e6');
      doc.font('Helvetica-Bold').fontSize(6).fillColor('#333')
         .text('(CAD 2025)', ML+3, y+3, {width:lw-6,height:10,lineBreak:false});

      let cx = ML + lw;
      doc.rect(cx, y, dw, 14).fill('#d4edda');
      doc.font('Helvetica-Bold').fontSize(6).fillColor('#155724')
         .text('SUBJECT', cx+3, y+3, {width:dw-6,height:10,align:'center',lineBreak:false});
      cx += dw;

      pcs.forEach(comp => {
        const gi = cd.indexOf(comp);
        const isMed = gi === mi;
        doc.rect(cx, y, dw, 14).fill(isMed ? '#fff3cd' : '#e2e3e5');
        doc.font('Helvetica-Bold').fontSize(6).fillColor('#333')
           .text(isMed ? 'MEDIAN COMP' : `COMP ${gi+1}`, cx+3, y+3, {width:dw-6,height:10,align:'center',lineBreak:false});
        cx += dw;
      });
      y += 14;

      // Data rows
      rows.forEach((r, ri) => {
        if (r.l === '---') { y += 2; return; }
        const bg = r.adj ? '#fafafa' : (ri%2===0 ? '#fff' : '#f8f9fa');
        const fs = r.tot ? 7.5 : 6;
        const fn = (r.bold||r.tot) ? 'Helvetica-Bold' : 'Helvetica';
        const tc = r.tot ? '#155724' : '#333';

        doc.rect(ML, y, lw, rh).fill(bg);
        doc.lineWidth(0.2).moveTo(ML,y+rh).lineTo(ML+lw,y+rh).stroke('#ddd');
        doc.font(fn).fontSize(fs).fillColor('#333')
           .text(r.l, ML+3, y+2, {width:lw-6,height:rh-2,lineBreak:false});

        cx = ML + lw;
        doc.rect(cx, y, dw, rh).fill(bg);
        doc.lineWidth(0.2).moveTo(cx,y+rh).lineTo(cx+dw,y+rh).stroke('#ddd');
        doc.font('Helvetica').fontSize(fs).fillColor(tc)
           .text(s(r.sv()), cx+2, y+2, {width:dw-4,height:rh-2,align:'center',lineBreak:false});
        cx += dw;

        pcs.forEach(comp => {
          doc.rect(cx, y, dw, rh).fill(bg);
          doc.lineWidth(0.2).moveTo(cx,y+rh).lineTo(cx+dw,y+rh).stroke('#ddd');
          doc.font(fn).fontSize(fs).fillColor(tc)
             .text(s(r.cv(comp)), cx+2, y+2, {width:dw-4,height:rh-2,align:'center',lineBreak:false});
          cx += dw;
        });
        y += rh;
      });
    }

    // Comp pages
    for (let i = 0; i < cd.length; i += CPP) {
      if (i > 0) doc.addPage({layout:'landscape'});
      drawCompPage(cd.slice(i, i+CPP));
    }

    // Formulas page
    doc.addPage({layout:'landscape'});
    let fy = ML;
    doc.rect(ML, fy, PW-60, 20).fill('#2c3e50');
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#fff')
       .text('OverAssessed.ai', ML+8, fy+6, {width:200,height:10,lineBreak:false});
    fy += 22;
    doc.rect(ML, fy, PW-60, 14).fill('#34495e');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#fff')
       .text('Adjustment Formulas & Summary', ML, fy+2, {width:PW-60,align:'center',height:12,lineBreak:false});
    fy += 20;

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a2e')
       .text('Adjustment Formulas:', ML+5, fy, {width:400,height:12,lineBreak:false});
    fy += 14;
    const fms = [
      'Appraised values reflect updated 2025 values, where available.',
      'Size Adjustment: (Comp Impr PSF x (Subj Main Area - Comp Main Area) / 2)',
      'Age Adjustment: (0.5 x (Subject EYOC - Comp EYOC) / 100) x Comp Market Value',
      'Land Adjustment: Subject Land Value - Comp Land Value',
      'Feature Adjustment: Subject Feature Value - Comp Feature Value',
      'Pool Adjustment: Subject Pool Value - Comp Pool Value',
      'Comps selected using Property Class, Distance, Condition, Size, and Year Built.',
    ];
    doc.font('Helvetica').fontSize(7.5).fillColor('#555');
    fms.forEach(f => {
      doc.text('  \u2022 ' + f, ML+10, fy, {width:PW-80,height:10,lineBreak:false});
      fy += 12;
    });
    fy += 10;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a2e')
       .text('Data Sources:', ML+5, fy, {width:400,height:12,lineBreak:false});
    fy += 14;
    doc.font('Helvetica').fontSize(7.5).fillColor('#555');
    [`${client.county} County Appraisal District (2025 Values)`,
     'RentCast API (comparable sales & AVM)',
     'OverAssessed.ai property tax analysis engine'].forEach(f => {
      doc.text('  \u2022 ' + f, ML+10, fy, {width:PW-80,height:10,lineBreak:false});
      fy += 12;
    });
    fy += 15;
    const diff = client.marketValue - medV;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#2e7d32')
       .text(`INDICATED VALUE: ${cur(medV)} (Median of ${cd.length} adjusted comparables)`, ML+5, fy, {width:PW-80,height:14,lineBreak:false});
    fy += 16;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#cc0000')
       .text(`CURRENT CAD VALUE: ${cur(client.marketValue)}`, ML+5, fy, {width:PW-80,height:14,lineBreak:false});
    fy += 16;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a1a2e')
       .text(`PROPOSED REDUCTION: ${cur(diff)} (${(diff/client.marketValue*100).toFixed(1)}%)`, ML+5, fy, {width:PW-80,height:14,lineBreak:false});

    // Now add footers to all pages using buffered pages
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(6).fillColor('#999');
      const footerText = `Account: ${client.taxId}    ${client.county} County        ${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}    Page ${i+1} of ${range.count}        Confidential    Generated by OverAssessed.ai`;
      doc.text(footerText, ML, PH - 20, {width: PW - 60, align: 'center', height: 10, lineBreak: false});
    }

    doc.end();
    ws.on('finish', () => { console.log('OK: ' + fp); resolve(fp); });
    ws.on('error', reject);
  });
}

async function main() {
  console.log('=== GEN TAXNET V4 ===');
  for (const c of clients) {
    try { await gen(c); } catch(e) { console.error('FAIL:', c.caseNum, e.message); }
  }
  console.log('=== DONE ===');
}
main();
