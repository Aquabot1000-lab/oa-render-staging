# Google Ads API - Design Documentation
## Worthey Aquatics / OverAssessed

### Company Overview
Worthey Aquatics is a pool construction and service company based in San Antonio, TX. OverAssessed is our property tax protest service. Both businesses use Google Ads for local lead generation.

### API Usage Purpose
**Read-only campaign performance reporting** for an internal business intelligence dashboard.

### How We Use the Google Ads API

#### 1. Campaign Performance Reporting
- Pull daily/weekly/monthly campaign metrics (impressions, clicks, conversions, cost)
- Calculate key performance indicators: CPA, ROAS, CTR
- Display metrics on an internal admin dashboard

#### 2. Search Terms Analysis
- Retrieve search term reports to identify high-performing and wasteful queries
- Inform manual keyword optimization decisions

#### 3. Geographic Performance
- Pull location-based performance data
- Analyze which service areas generate the best ROI

#### 4. Budget Monitoring
- Track daily spend against budget targets
- Alert when campaigns approach budget limits

### Technical Architecture
- **Backend:** Node.js server (Express)
- **API Library:** google-ads-api (npm package)
- **Authentication:** OAuth 2.0 with refresh token
- **Data Storage:** Internal database for historical trend analysis
- **Access Level:** Read-only (no automated campaign modifications)

### API Operations Used
- `customer.query()` — GAQL queries for reporting data
- `SearchGoogleAdsRequest` — campaign, ad group, keyword, and search term reports
- No mutate operations (no campaign creation, modification, or deletion)

### Rate Limiting
- Queries run on scheduled intervals (every 6 hours)
- No high-frequency polling
- Estimated daily API calls: < 100

### User Access
- Single admin user (business owner)
- No external/third-party access
- No reselling of data

### Compliance
- All data is used internally for business performance optimization
- No PII is shared externally
- Compliant with Google Ads API Terms of Service
