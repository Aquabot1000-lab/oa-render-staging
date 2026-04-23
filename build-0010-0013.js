require('dotenv').config();
const { generateTaxNetPackage } = require('./server/services/taxnet-package-generator');

async function buildOA0010() {
  const caseData = { case_id: 'OA-0010', owner_name: 'Khiem Nguyen', county: 'Fort Bend', state: 'TX', phone: '', email: '' };
  const property = {
    address: '3315 Marlene Meadow Way, Richmond, TX 77406', county: 'fort bend', accountId: 'R523440',
    geoId: '5296-09-002-0200-901', sqft: 3718, yearBuilt: 2023, effectiveYear: 2023,
    assessedValue: 598408, landValue: 63050, improvementValue: 535358, featureValue: 0, poolValue: 0,
    propClass: 'A1', conditionLabel: 'Average', conditionScore: 3, neighborhoodCode: '2000',
    legalDescription: 'McCrary Meadows Sec 9, BLOCK 2, Lot 20', ownerName: 'Nguyen, Khiem Duc',
    opinionOfValue: 569921, acres: 0.19
  };
  const comps = [
    { propId:'R523423', parcelId:'R523423', address:'2918 Opal Ivory WAY, Richmond, TX 77406', marketValue:583405, landValue:65000, improvValue:532448, sqft:3646, yearBuilt:2023, effectiveYear:2023, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:0.60, featureValue:0, poolValue:0 },
    { propId:'R523424', parcelId:'R523424', address:'2914 Opal Ivory WAY, Richmond, TX 77406', marketValue:619777, landValue:68250, improvValue:531750, sqft:3716, yearBuilt:2023, effectiveYear:2023, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:0.57, featureValue:0, poolValue:0 },
    { propId:'R523413', parcelId:'R523413', address:'3226 Willow Fin WAY, Richmond, TX 77406', marketValue:575643, landValue:63050, improvValue:538183, sqft:3816, yearBuilt:2023, effectiveYear:2023, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:0.40, featureValue:0, poolValue:0 },
    { propId:'R523409', parcelId:'R523409', address:'3302 Willow Fin WAY, Richmond, TX 77406', marketValue:569352, landValue:63050, improvValue:531600, sqft:3731, yearBuilt:2023, effectiveYear:2023, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:0.54, featureValue:0, poolValue:0 },
    { propId:'R523434', parcelId:'R523434', address:'3219 Marlene Meadow WAY, Richmond, TX 77406', marketValue:556283, landValue:63050, improvValue:539654, sqft:3400, yearBuilt:2023, effectiveYear:2023, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:0.33, featureValue:0, poolValue:0 },
    { propId:'R497762', parcelId:'R497762', address:'3414 Willow Fin WAY, Richmond, TX 77406', marketValue:589105, landValue:63050, improvValue:529350, sqft:3839, yearBuilt:2023, effectiveYear:2023, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:0.17, featureValue:0, poolValue:0 },
    { propId:'R523407', parcelId:'R523407', address:'3310 Willow Fin WAY, Richmond, TX 77406', marketValue:584577, landValue:61100, improvValue:543515, sqft:3622, yearBuilt:2023, effectiveYear:2023, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:0.20, featureValue:0, poolValue:0 },
    { propId:'R523412', parcelId:'R523412', address:'3230 Willow Fin WAY, Richmond, TX 77406', marketValue:580130, landValue:63050, improvValue:528950, sqft:3735, yearBuilt:2023, effectiveYear:2023, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:0.55, featureValue:0, poolValue:0 },
    { propId:'R523443', parcelId:'R523443', address:'3306 Marlene Meadow WAY, Richmond, TX 77406', marketValue:597799, landValue:100880, improvValue:489120, sqft:3441, yearBuilt:2023, effectiveYear:2023, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:0.16, featureValue:0, poolValue:0 },
    { propId:'R523436', parcelId:'R523436', address:'3227 Marlene Meadow WAY, Richmond, TX 77406', marketValue:590416, landValue:63050, improvValue:544450, sqft:3790, yearBuilt:2023, effectiveYear:2023, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:0.16, featureValue:0, poolValue:0 },
    { propId:'R523408', parcelId:'R523408', address:'3306 Willow Fin WAY, Richmond, TX 77406', marketValue:582040, landValue:63050, improvValue:544921, sqft:3741, yearBuilt:2023, effectiveYear:2023, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:0.20, featureValue:0, poolValue:0 },
    { propId:'R523457', parcelId:'R523457', address:'3235 Willow Fin WAY, Richmond, TX 77406', marketValue:618527, landValue:100880, improvValue:489102, sqft:3622, yearBuilt:2023, effectiveYear:2023, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:0.15, featureValue:0, poolValue:0 }
  ];
  return generateTaxNetPackage(caseData, property, comps);
}

async function buildOA0013() {
  const caseData = { case_id: 'OA-0013', owner_name: 'Shabir Hasanali Rupani', county: 'Collin', state: 'TX', phone: '', email: 'arupani4@gmail.com' };
  const property = {
    address: '708 Santa Lucia Dr, Anna, TX 75409', county: 'collin',
    accountId: 'Pending — to be updated before filing', geoId: 'R-13273-00J-0230-1',
    sqft: 1781, yearBuilt: 2024, effectiveYear: 2024, assessedValue: 394095,
    landValue: 125000, improvementValue: 269095, featureValue: 0, poolValue: 0,
    propClass: 'A1', conditionLabel: 'Good', conditionScore: 3, neighborhoodCode: 'N13012',
    legalDescription: 'Mantua Point Phase 3, Block J, Lot 23', ownerName: 'Rupani, Shabir Hasanali',
    opinionOfValue: 368240, acres: 0.15
  };
  const comps = [
    { propId:'R-13273-00J-0250-1', parcelId:'R-13273-00J-0250-1', address:'740 Santa Lucia Dr, Anna, TX 75409', marketValue:359000, landValue:125000, improvValue:234000, sqft:1777, yearBuilt:2024, effectiveYear:2024, conditionLabel:'Good', conditionScore:3, propClass:'A1', distance:0.05, featureValue:0, poolValue:0, acres:0.14 },
    { propId:'R-13273-00K-0010-1', parcelId:'R-13273-00K-0010-1', address:'901 Portina Dr, Anna, TX 75409', marketValue:367500, landValue:125000, improvValue:242500, sqft:1777, yearBuilt:2024, effectiveYear:2024, conditionLabel:'Good', conditionScore:3, propClass:'A1', distance:0.16, featureValue:0, poolValue:0, acres:0.14 },
    { propId:'R-13273-00J-0070-1', parcelId:'R-13273-00J-0070-1', address:'221 Santa Lucia Dr, Anna, TX 75409', marketValue:375000, landValue:126000, improvValue:249000, sqft:1799, yearBuilt:2023, effectiveYear:2023, conditionLabel:'Good', conditionScore:3, propClass:'A1', distance:0.17, featureValue:0, poolValue:0, acres:0.15 },
    { propId:'R-13273-00K-0040-1', parcelId:'R-13273-00K-0040-1', address:'924 Amenduni Ln, Anna, TX 75409', marketValue:367900, landValue:125000, improvValue:242900, sqft:1777, yearBuilt:2024, effectiveYear:2024, conditionLabel:'Good', conditionScore:3, propClass:'A1', distance:0.20, featureValue:0, poolValue:0, acres:0.14 },
    { propId:'R-13273-00L-0050-1', parcelId:'R-13273-00L-0050-1', address:'1309 Renato Dr, Anna, TX 75409', marketValue:375000, landValue:126000, improvValue:249000, sqft:1799, yearBuilt:2024, effectiveYear:2024, conditionLabel:'Good', conditionScore:3, propClass:'A1', distance:0.24, featureValue:0, poolValue:0, acres:0.15 },
    { propId:'2887188', parcelId:'2887188', address:'313 Amenduni Ln, Anna, TX 75409', marketValue:391378, landValue:125000, improvValue:266378, sqft:1781, yearBuilt:2024, effectiveYear:2024, conditionLabel:'Good', conditionScore:3, propClass:'A1', distance:0.22, featureValue:0, poolValue:0, acres:0.15 },
    { propId:'2906428', parcelId:'2906428', address:'721 Amenduni Ln, Anna, TX 75409', marketValue:381193, landValue:125000, improvValue:256193, sqft:1832, yearBuilt:2024, effectiveYear:2024, conditionLabel:'Good', conditionScore:3, propClass:'A1', distance:0.19, featureValue:0, poolValue:0, acres:0.15 },
    { propId:'2887162', parcelId:'2887162', address:'321 Portina Dr, Anna, TX 75409', marketValue:408929, landValue:125000, improvValue:283929, sqft:1799, yearBuilt:2024, effectiveYear:2024, conditionLabel:'Good', conditionScore:3, propClass:'A1', distance:0.18, featureValue:0, poolValue:0, acres:0.14 }
  ];
  return generateTaxNetPackage(caseData, property, comps);
}

(async () => {
  try {
    console.log('Building OA-0010...');
    const r1 = await buildOA0010();
    console.log('OA-0010 DONE:', r1.stats.min);
    console.log('Building OA-0013...');
    const r2 = await buildOA0013();
    console.log('OA-0013 DONE:', r2.stats.min);
    console.log('ALL DONE');
  } catch(e) { console.error('FAILED:', e.message); console.error(e.stack); process.exit(1); }
})();
