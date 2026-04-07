
const { findVerifiedComps } = require('./services/verified-comp-engine');

async function runRecovery() {
    const results = [];

    // Case OA-0027 - Highly Recoverable
    const oa0027_subject = {
        address: "24209 Scenic Loop Rd, San Antonio, TX 78255",
        assessedValue: 854820,
        sqft: 4732,
        bedrooms: 4,
        bathrooms: 5.5,
        yearBuilt: 2017,
        lotSize: 16.13 * 43560, // Convert acres to sqft
        propertyType: "Single Family Home"
        // Other fields from original property_data can be added if needed by the engine
        // landValue: subject.landValue, improvementValue: subject.improvementValue, neighborhoodCode: subject.neighborhoodCode
    };
    const oa0027_caseData = {
        case_id: "OA-0027",
        county: "Bexar",
        property_address: "24209 Scenic Loop Rd, San Antonio, TX 78255",
        assessed_value: "854820",
        property_data: {
             "sqft": 4732, "bedrooms": 4, "bathrooms": 5.5, "yearBuilt": 2017, "lotSize": 16.13 * 43560,
             "source": "intake-fallback", "address": "24209 Scenic Loop Rd", "ownerName": "Juan Villarreal",
             "fetchedAt": "2026-03-23T13:38:26.990Z", "landValue": 213705, "improvementValue": 641115,
             "propertyType": "Single Family Home", "assessedValue": 854820
        }
    };
    const oa0027_result = await findVerifiedComps(oa0027_subject, oa0027_caseData);
    results.push({ case_id: "OA-0027", result: oa0027_result });


    // Case OA-0020 - Recoverable (missing lotSize)
    const oa0020_subject = {
        address: "4709 Lawrence Ln, Plano, TX 75093",
        assessedValue: 500000,
        sqft: 2856, // from original property_data
        bedrooms: 4, // found via web search
        bathrooms: 2.5, // found via web search
        yearBuilt: 1994, // from original property_data
        lotSize: null, // still missing
        propertyType: "Single Family Home"
    };
    const oa0020_caseData = {
        case_id: "OA-0020",
        county: "Collin",
        property_address: "4709 Lawrence Ln Plano, TX 75093",
        assessed_value: "$500,000",
        property_data: {
             "sqft": 2856, "source": "intake-fallback", "address": "4709 Lawrence Ln Plano, TO 75093",
             "ownerName": "Kevin Matinfar", "fetchedAt": "2026-03-21T02:41:39.121Z", "landValue": 125000,
             "yearBuilt": 1994, "bedrooms": 4, "bathrooms": 2.5, "propertyType": "Single Family Home",
             "assessedValue": 500000
        }
    };
    const oa0020_result = await findVerifiedComps(oa0020_subject, oa0020_caseData);
    results.push({ case_id: "OA-0020", result: oa0020_result });

    // Case OA-0030 - Recoverable (missing lotSize)
    const oa0030_subject = {
        address: "294 Hascall Rd NW, Atlanta, GA 30309",
        assessedValue: 300000, // from property_data.assessedValue
        sqft: 2400, // from original property_data
        bedrooms: 3, // found via web search
        bathrooms: 3.5, // from original property_data
        yearBuilt: 1980, // from original property_data
        lotSize: null, // still missing
        propertyType: "Single Family Home"
    };
    const oa0030_caseData = {
        case_id: "OA-0030",
        county: "Fulton",
        property_address: "294 hascall rd nw",
        assessed_value: null, // Using assessedValue from property_data
        property_data: {
             "sqft": 2400, "source": "intake-fallback", "address": "294 hascall rd nw",
             "ownerName": "Tung Tran", "fetchedAt": "2026-03-26T12:58:57.673Z", "landValue": 75000,
             "yearBuilt": 1980, "bedrooms": 3, "bathrooms": 3.5, "propertyType": "Single Family Home",
             "assessedValue": 300000
        }
    };
    const oa0030_result = await findVerifiedComps(oa0030_subject, oa0030_caseData);
    results.push({ case_id: "OA-0030", result: oa0030_result });


    // Case OA-0034 - Recoverable (missing lotSize)
    const oa0034_subject = {
        address: "405 Deerpath St, Leander TX 78641",
        assessedValue: 450000, // from property_data.assessedValue
        sqft: 2100, // from original property_data
        bedrooms: 5, // from original property_data
        bathrooms: 3, // from original property_data
        yearBuilt: 2023, // from original property_data
        lotSize: null, // still missing
        propertyType: "Single Family Home"
    };
    const oa0034_caseData = {
        case_id: "OA-0034",
        county: "Williamson",
        property_address: "405 Deerpath St, Leander TX78641",
        assessed_value: "$450,000",
        property_data: {
             "sqft": 2100, "source": "intake-fallback", "address": "405 Deerpath St, Leander TX78641",
             "ownerName": "Yew Wah Yeem", "fetchedAt": "2026-03-26T01:19:10.391Z", "landValue": 112500,
             "yearBuilt": 2023, "bedrooms": 5, "bathrooms": 3, "propertyType": "Single Family Home",
             "assessedValue": 450000
        }
    };
    const oa0034_result = await findVerifiedComps(oa0034_subject, oa0034_caseData);
    results.push({ case_id: "OA-0034", result: oa0034_result });


    // Case OA-0017 - Recoverable (missing bathrooms, lotSize)
    const oa0017_subject = {
        address: "2754 Canvas Back Drive, Greenville, TX 75402",
        assessedValue: 428720, // from property_data.assessedValue
        sqft: 2136, // from original property_data
        bedrooms: 4, // from original property_data
        bathrooms: null, // still missing
        yearBuilt: 2024, // from original property_data
        lotSize: null, // still missing
        propertyType: "Single Family Home"
    };
    const oa0017_caseData = {
        case_id: "OA-0017",
        county: "Hunt",
        property_address: "2754 Canvas Back Drive, Greenville, TX 75402",
        assessed_value: "$428,720",
        property_data: {
            "sqft": 2136, "source": "intake-fallback", "address": "22754 Canvas Back Drive, Greenville, TX 75402",
            "ownerName": "TRACY FURLONG", "fetchedAt": "2026-03-24T13:33:16.206Z", "landValue": 107180,
            "yearBuilt": 2024, "bedrooms": 4, "propertyType": "Single Family Home",
            "assessedValue": 428720
        }
    };
    const oa0017_result = await findVerifiedComps(oa0017_subject, oa0017_caseData);
    results.push({ case_id: "OA-0017", result: oa0017_result });


    console.log(JSON.stringify(results, null, 2));
}

runRecovery();
