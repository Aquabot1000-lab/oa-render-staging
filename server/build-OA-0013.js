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
  accountId: null,  // MISSING — flag but build
  geoId: null,
  sqft: 1781,
  yearBuilt: 2024,
  effectiveYear: 2024,
  assessedValue: 394095,
  landValue: 69998,
  improvementValue: 279990 - 69998,  // ~209992
  featureValue: 0,
  poolValue: 0,
  propClass: 'A1',
  conditionLabel: 'Average',
  conditionScore: 3,
  neighborhoodCode: null,
  legalDescription: null,
  ownerName: 'Shabir Hasanali Rupani',
  opinionOfValue: 368240,
  acres: 0.0
};

// 5 verified TaxNet USA comps already in comp_results
const comps = [
  { propId:'R-13273-00J-0250-1', parcelId:'R-13273-00J-0250-1', address:'740 Santa Lucia Dr, Anna TX', marketValue:359000, landValue:125000, improvValue:234000, sqft:1777, yearBuilt:2024, effectiveYear:2024, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:0.05, featureValue:0, poolValue:0 },
  { propId:'R-13273-00K-0010-1', parcelId:'R-13273-00K-0010-1', address:'901 Portina Dr, Anna TX', marketValue:367500, landValue:125000, improvValue:242500, sqft:1777, yearBuilt:2024, effectiveYear:2024, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:0.16, featureValue:0, poolValue:0 },
  { propId:'R-13273-00J-0070-1', parcelId:'R-13273-00J-0070-1', address:'221 Santa Lucia Dr, Anna TX', marketValue:375000, landValue:126000, improvValue:249000, sqft:1799, yearBuilt:2023, effectiveYear:2023, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:0.17, featureValue:0, poolValue:0 },
  { propId:'R-13273-00K-0040-1', parcelId:'R-13273-00K-0040-1', address:'924 Amenduni Ln, Anna TX', marketValue:367900, landValue:125000, improvValue:242900, sqft:1777, yearBuilt:2024, effectiveYear:2024, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:0.20, featureValue:0, poolValue:0 },
  { propId:'R-13273-00L-0050-1', parcelId:'R-13273-00L-0050-1', address:'1309 Renato Dr, Anna TX', marketValue:375000, landValue:126000, improvValue:249000, sqft:1799, yearBuilt:2024, effectiveYear:2024, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:0.24, featureValue:0, poolValue:0 }
];

generateTaxNetPackage(caseData, property, comps)
  .then(result => {
    console.log('SUCCESS:', JSON.stringify(result));
  })
  .catch(err => {
    console.error('FAILED:', err.message);
    process.exit(1);
  });
