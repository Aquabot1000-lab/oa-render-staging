
require('dotenv').config();
const { generateTaxNetPackage } = require('./server/services/taxnet-package-generator');

async function build() {
  const caseData = { case_id: 'OA-0027', owner_name: 'Villarreal Brothers Investments LLC', county: 'Bexar', state: 'TX', phone: '(210) 596-6699', email: 'juanvillarreal@outlook.com' };
  const property = {
    address: '24209 Scenic Loop Rd, San Antonio, TX 78255', county: 'bexar', accountId: '250941',
    geoId: '04703-010-0020', sqft: 1800, yearBuilt: 2017, effectiveYear: 2017,
    assessedValue: 812660, landValue: 506950, improvementValue: 305710, featureValue: 0, poolValue: 0,
    propClass: 'A1', conditionLabel: 'Good', conditionScore: 3, neighborhoodCode: null,
    legalDescription: 'A-703 SURV 381 J W MCDANIEL 9.9 AC', ownerName: 'Villarreal Brothers Investments LLC',
    opinionOfValue: 702845, acres: 9.9, bedrooms: 4, bathrooms: 5.5
  };
  const comps = [
    { propId:'SL-18211', parcelId:'SL-18211', address:'18211 Scenic Loop Rd, San Antonio, TX 78255', marketValue:617000, landValue:218100, improvValue:398900, sqft:1812, yearBuilt:1993, effectiveYear:2005, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:4.5, featureValue:0, poolValue:0, acres:3.5 },
    { propId:'SL-21985', parcelId:'SL-21985', address:'21985 Scenic Loop Rd, San Antonio, TX 78255', marketValue:575900, landValue:257350, improvValue:318550, sqft:1720, yearBuilt:1960, effectiveYear:2000, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:1.7, featureValue:0, poolValue:0, acres:5.0 },
    { propId:'SL-24210', parcelId:'SL-24210', address:'24210 Scenic Loop Rd, San Antonio, TX 78255', marketValue:905000, landValue:377130, improvValue:527870, sqft:1433, yearBuilt:1966, effectiveYear:2000, conditionLabel:'Good', conditionScore:3, propClass:'A1', distance:0.1, featureValue:0, poolValue:0, acres:8.0 },
    { propId:'HC-20619', parcelId:'HC-20619', address:'20619 Helotes Creek Rd, San Antonio, TX 78255', marketValue:614340, landValue:312280, improvValue:302060, sqft:2127, yearBuilt:1981, effectiveYear:2000, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:3.2, featureValue:0, poolValue:0, acres:7.0 },
    { propId:'HC-20111', parcelId:'HC-20111', address:'20111 Helotes Creek Rd, San Antonio, TX 78255', marketValue:521190, landValue:247040, improvValue:274150, sqft:1883, yearBuilt:1999, effectiveYear:1999, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:3.3, featureValue:0, poolValue:0, acres:4.0 },
    { propId:'HC-20105', parcelId:'HC-20105', address:'20105 Helotes Creek Rd, San Antonio, TX 78255', marketValue:503900, landValue:363240, improvValue:140660, sqft:1748, yearBuilt:1983, effectiveYear:2000, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:3.2, featureValue:0, poolValue:0, acres:7.0 },
    { propId:'HC-20616', parcelId:'HC-20616', address:'20616 Helotes Creek Rd, San Antonio, TX 78255', marketValue:569000, landValue:260650, improvValue:308350, sqft:2166, yearBuilt:1990, effectiveYear:2000, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:3.2, featureValue:0, poolValue:0, acres:4.5 },
    { propId:'HC-20609', parcelId:'HC-20609', address:'20609 Helotes Creek Rd, San Antonio, TX 78255', marketValue:533360, landValue:295010, improvValue:238350, sqft:2041, yearBuilt:1982, effectiveYear:2000, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:3.5, featureValue:0, poolValue:0, acres:5.0 },
    { propId:'HC-20610', parcelId:'HC-20610', address:'20610 Helotes Creek Rd, San Antonio, TX 78255', marketValue:508300, landValue:216140, improvValue:292160, sqft:2186, yearBuilt:1996, effectiveYear:2000, conditionLabel:'Average', conditionScore:3, propClass:'A1', distance:3.4, featureValue:0, poolValue:0, acres:4.0 },
    { propId:'BS-44', parcelId:'BS-44', address:'44 Boerne Stage Airfield, San Antonio, TX 78255', marketValue:640000, landValue:238410, improvValue:401590, sqft:1796, yearBuilt:2017, effectiveYear:2017, conditionLabel:'Good', conditionScore:3, propClass:'A1', distance:3.8, featureValue:0, poolValue:0, acres:2.5 }
  ];
  const r = await generateTaxNetPackage(caseData, property, comps);
  console.log('DONE:', JSON.stringify(r));
}
build().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
