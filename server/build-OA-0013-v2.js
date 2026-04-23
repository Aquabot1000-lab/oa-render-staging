require('dotenv').config();
const { generateTaxNetPackage } = require('./services/taxnet-package-generator');

const caseData = {
  case_id: 'OA-0013',
  owner_name: 'Shabir Hasanali Rupani',
  county: 'Collin',
  state: 'TX',
  phone: '',
  email: 'arupani4@gmail.com'
};

const property = {
  address: '708 Santa Lucia Dr, Anna, TX 75409',
  county: 'collin',
  accountId: 'Pending — to be updated before filing',
  geoId: 'R-13273-00J-0230-1',
  sqft: 1781,
  yearBuilt: 2024,
  effectiveYear: 2024,
  assessedValue: 394095,
  landValue: 125000,
  improvementValue: 269095,
  featureValue: 0,
  poolValue: 0,
  propClass: 'A1',
  conditionLabel: 'Good',
  conditionScore: 3,
  neighborhoodCode: 'N13012',
  legalDescription: 'Mantua Point Phase 3, Block J, Lot 23',
  ownerName: 'Rupani, Shabir Hasanali',
  opinionOfValue: 368240,
  acres: 0.15
};

const comps = [
  // Original 5 comps (CCAD / TaxNet USA verified)
  { propId:'R-13273-00J-0250-1', parcelId:'R-13273-00J-0250-1', address:'740 Santa Lucia Dr, Anna, TX 75409',  marketValue:359000, landValue:125000, improvValue:234000, sqft:1777, yearBuilt:2024, effectiveYear:2024, conditionLabel:'Good', conditionScore:3, propClass:'A1', distance:0.05, featureValue:0, poolValue:0, acres:0.14 },
  { propId:'R-13273-00K-0010-1', parcelId:'R-13273-00K-0010-1', address:'901 Portina Dr, Anna, TX 75409',       marketValue:367500, landValue:125000, improvValue:242500, sqft:1777, yearBuilt:2024, effectiveYear:2024, conditionLabel:'Good', conditionScore:3, propClass:'A1', distance:0.16, featureValue:0, poolValue:0, acres:0.14 },
  { propId:'R-13273-00J-0070-1', parcelId:'R-13273-00J-0070-1', address:'221 Santa Lucia Dr, Anna, TX 75409',   marketValue:375000, landValue:126000, improvValue:249000, sqft:1799, yearBuilt:2023, effectiveYear:2023, conditionLabel:'Good', conditionScore:3, propClass:'A1', distance:0.17, featureValue:0, poolValue:0, acres:0.15 },
  { propId:'R-13273-00K-0040-1', parcelId:'R-13273-00K-0040-1', address:'924 Amenduni Ln, Anna, TX 75409',      marketValue:367900, landValue:125000, improvValue:242900, sqft:1777, yearBuilt:2024, effectiveYear:2024, conditionLabel:'Good', conditionScore:3, propClass:'A1', distance:0.20, featureValue:0, poolValue:0, acres:0.14 },
  { propId:'R-13273-00L-0050-1', parcelId:'R-13273-00L-0050-1', address:'1309 Renato Dr, Anna, TX 75409',       marketValue:375000, landValue:126000, improvValue:249000, sqft:1799, yearBuilt:2024, effectiveYear:2024, conditionLabel:'Good', conditionScore:3, propClass:'A1', distance:0.24, featureValue:0, poolValue:0, acres:0.15 },
  // 3 new comps — BIS live values + Collin parcel sqft — same Mantua Point subdivision
  { propId:'2887188', parcelId:'2887188', address:'313 Amenduni Ln, Anna, TX 75409', marketValue:391378, landValue:125000, improvValue:266378, sqft:1781, yearBuilt:2024, effectiveYear:2024, conditionLabel:'Good', conditionScore:3, propClass:'A1', distance:0.22, featureValue:0, poolValue:0, acres:0.15 },
  { propId:'2906428', parcelId:'2906428', address:'721 Amenduni Ln, Anna, TX 75409', marketValue:381193, landValue:125000, improvValue:256193, sqft:1832, yearBuilt:2024, effectiveYear:2024, conditionLabel:'Good', conditionScore:3, propClass:'A1', distance:0.19, featureValue:0, poolValue:0, acres:0.15 },
  { propId:'2887162', parcelId:'2887162', address:'321 Portina Dr, Anna, TX 75409',  marketValue:408929, landValue:125000, improvValue:283929, sqft:1799, yearBuilt:2024, effectiveYear:2024, conditionLabel:'Good', conditionScore:3, propClass:'A1', distance:0.18, featureValue:0, poolValue:0, acres:0.14 },
];

generateTaxNetPackage(caseData, property, comps)
  .then(result => { console.log('SUCCESS:', JSON.stringify(result)); })
  .catch(err => { console.error('FAILED:', err.message); process.exit(1); });
