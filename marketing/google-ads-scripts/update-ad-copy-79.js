/**
 * OverAssessed — Google Ads Script: Update All Ad Copy to $79 Initiation Fee
 * 
 * HOW TO USE:
 * 1. Go to Google Ads → Tools → Scripts
 * 2. Click + New Script
 * 3. Paste this entire script
 * 4. Click Preview first to see what will change (dry run)
 * 5. Click Run to apply changes
 * 
 * WHAT IT DOES:
 * - Finds all responsive search ads across all campaigns
 * - Replaces "No Win, No Fee" headlines with "$79 To Get Started"
 * - Replaces "Free" language that conflicts with $79 fee
 * - Updates descriptions mentioning "no upfront" or "no win, no fee" or "free"
 * - Enforces character limits (headlines ≤30, descriptions ≤90)
 * - Adds new $79-focused headlines where there's room
 * - Logs all changes for review
 * 
 * v2 — Fixed: "Free" in descriptions conflicting with $79 (Google policy violation)
 *      Fixed: Character limit enforcement
 */

function main() {
  var DRY_RUN = false; // Set to true to preview without making changes
  
  Logger.log("=== OverAssessed Ad Copy Update Script v2 ===");
  Logger.log("Mode: " + (DRY_RUN ? "DRY RUN (preview only)" : "LIVE (making changes)"));
  Logger.log("");
  
  var MAX_HEADLINE_CHARS = 30;
  var MAX_DESCRIPTION_CHARS = 90;
  
  // Define replacements for headlines (each replacement must be ≤30 chars)
  var headlineReplacements = [
    { find: "No Win, No Fee - Only 20%", replace: "Just $79 To Get Started" },
    { find: "No Win No Fee - 20%", replace: "Just $79 To Get Started" },
    { find: "No Win No Fee - 30% Only", replace: "Just $79 To Get Started" },
    { find: "No Win, No Fee - Only 30%", replace: "Just $79 To Get Started" },
    { find: "No Win, No Fee - Only 25%", replace: "Just $79 To Get Started" },
    { find: "No Win No Fee", replace: "$79 To Start — Fee Credited" },
    { find: "Free Property Tax Analysis", replace: "$79 To Start — Fee Credited" },
    { find: "Free Tax Analysis", replace: "$79 — Fee Credited" },
    { find: "Free Analysis", replace: "$79 — Fee Credited" },
  ];
  
  // Define replacements for descriptions (each replacement must be ≤90 chars)
  // Order matters — more specific patterns first
  var descriptionReplacements = [
    { 
      find: "We only charge 20% of your savings. $79 fee credited to savings. Free property tax analysis",
      replace: "We only charge 20% of your savings. $79 initiation fee credited toward your savings."
    },
    {
      find: "We only charge 25% of your savings. $79 fee credited to savings. Free property tax analysis",
      replace: "We only charge 25% of your savings. $79 initiation fee credited toward your savings."
    },
    {
      find: "We only charge 30% of your savings. $79 fee credited to savings. Free property tax analysis",
      replace: "We only charge 30% of your savings. $79 initiation fee credited toward your savings."
    },
    { 
      find: "We only charge 20% of your savings. No win, no fee.", 
      replace: "Just $79 to start — credited toward your 20% contingency fee. TX tax experts." 
    },
    { 
      find: "We only charge 25% of your savings. No win, no fee.", 
      replace: "Just $79 to start — credited toward your 25% contingency fee. Tax experts." 
    },
    { 
      find: "We only charge 30% of your savings. No win, no fee.", 
      replace: "Just $79 to start — credited toward your 30% contingency fee. Tax experts." 
    },
    {
      find: "Free property tax analysis",
      replace: "Expert property tax analysis"
    },
    {
      find: "Free tax analysis",
      replace: "Expert tax analysis"
    },
    {
      find: "free property tax analysis",
      replace: "expert property tax analysis"
    },
    { 
      find: "no upfront costs, pay only if you save", 
      replace: "Just $79 to start — credited toward your fee if we save you money" 
    },
    { 
      find: "No upfront cost", 
      replace: "Just $79 to start" 
    },
    {
      find: "no upfront costs",
      replace: "just $79 to start — credited toward your fee"
    },
    { 
      find: "No win, no fee", 
      replace: "$79 initiation fee credited toward savings" 
    },
    {
      find: "no win no fee",
      replace: "$79 initiation fee credited toward savings"
    },
  ];
  
  // Catch-all: any description still containing "free" (case-insensitive)
  // after all specific replacements — replace "Free" with "Expert" or "Professional"
  var freeCatchAll = [
    { find: /\bFree\b/g, replace: "Expert" },
    { find: /\bfree\b/g, replace: "expert" },
    { find: /\bFREE\b/g, replace: "EXPERT" },
  ];
  
  // New headlines to ADD (if ad has room, max 15) — all ≤30 chars
  var newHeadlinesToAdd = {
    "OA - TX Property Tax Protest - Search": [
      "Just $79 To Get Started",
      "TX Property Tax Experts",
    ],
    "OA - GA Property Tax Protest - Search": [
      "Just $79 To Get Started",
      "GA Property Tax Experts",
    ],
    "WA Property Tax Protest - Search": [
      "Just $79 To Get Started",
    ],
    "OA - OH Property Tax Protest - Search": [
      "Just $79 To Get Started",
      "Board of Revision Experts",
    ],
    "OA - CO Ski Town Property Tax - Search": [
      "Just $79 To Get Started",
      "CO Property Tax Experts",
    ],
  };
  
  var campaignIterator = AdsApp.campaigns().get();
  
  var totalAdsUpdated = 0;
  var totalChanges = 0;
  var errors = [];
  
  while (campaignIterator.hasNext()) {
    var campaign = campaignIterator.next();
    var campaignName = campaign.getName();
    Logger.log("--- Campaign: " + campaignName + " ---");
    
    var adGroupIterator = campaign.adGroups().get();
    
    while (adGroupIterator.hasNext()) {
      var adGroup = adGroupIterator.next();
      var adGroupName = adGroup.getName();
      var adIterator = adGroup.ads().get();
      
      while (adIterator.hasNext()) {
        var ad = adIterator.next();
        
        // Only process responsive search ads
        if (ad.getType() !== "RESPONSIVE_SEARCH_AD") continue;
        
        var rsa = ad.asType().responsiveSearchAd();
        var headlines = rsa.getHeadlines();
        var descriptions = rsa.getDescriptions();
        var finalUrl = rsa.urls().getFinalUrl();
        var adChanged = false;
        var changes = [];
        
        // Process headline replacements
        var newHeadlines = headlines.map(function(h) {
          var text = h.text;
          var pinning = h.pinnedField || null;
          
          for (var i = 0; i < headlineReplacements.length; i++) {
            if (text.toLowerCase().indexOf(headlineReplacements[i].find.toLowerCase()) !== -1) {
              changes.push("  Headline: '" + text + "' → '" + headlineReplacements[i].replace + "'");
              text = headlineReplacements[i].replace;
              adChanged = true;
              break;
            }
          }
          
          // Enforce character limit
          if (text.length > MAX_HEADLINE_CHARS) {
            var truncated = text.substring(0, MAX_HEADLINE_CHARS);
            changes.push("  ⚠️ Headline truncated: '" + text + "' (" + text.length + " chars) → '" + truncated + "'");
            text = truncated;
          }
          
          var result = { text: text };
          if (pinning) result.pinnedField = pinning;
          return result;
        });
        
        // Add new headlines if room (max 15)
        var campaignNewHeadlines = newHeadlinesToAdd[campaignName] || [];
        for (var h = 0; h < campaignNewHeadlines.length; h++) {
          if (newHeadlines.length < 15) {
            var exists = newHeadlines.some(function(nh) { 
              return nh.text.toLowerCase() === campaignNewHeadlines[h].toLowerCase(); 
            });
            if (!exists && campaignNewHeadlines[h].length <= MAX_HEADLINE_CHARS) {
              newHeadlines.push({ text: campaignNewHeadlines[h] });
              changes.push("  + Added headline: '" + campaignNewHeadlines[h] + "'");
              adChanged = true;
            }
          }
        }
        
        // Process description replacements
        var newDescriptions = descriptions.map(function(d) {
          var text = d.text;
          var pinning = d.pinnedField || null;
          var originalText = text;
          
          // Apply specific replacements first
          for (var i = 0; i < descriptionReplacements.length; i++) {
            if (text.toLowerCase().indexOf(descriptionReplacements[i].find.toLowerCase()) !== -1) {
              text = text.replace(new RegExp(escapeRegExp(descriptionReplacements[i].find), 'gi'), descriptionReplacements[i].replace);
              adChanged = true;
            }
          }
          
          // Catch-all: replace any remaining "Free" with "Expert"
          for (var f = 0; f < freeCatchAll.length; f++) {
            if (freeCatchAll[f].find.test(text)) {
              text = text.replace(freeCatchAll[f].find, freeCatchAll[f].replace);
              adChanged = true;
            }
          }
          
          // Enforce character limit
          if (text.length > MAX_DESCRIPTION_CHARS) {
            // Try to truncate at last space before limit
            var truncated = text.substring(0, MAX_DESCRIPTION_CHARS);
            var lastSpace = truncated.lastIndexOf(' ');
            if (lastSpace > 60) {
              truncated = truncated.substring(0, lastSpace) + ".";
            }
            changes.push("  ⚠️ Description trimmed: " + text.length + " → " + truncated.length + " chars");
            text = truncated;
          }
          
          if (text !== originalText) {
            changes.push("  Description: '" + originalText.substring(0, 60) + "...' → '" + text.substring(0, 60) + "...'");
          }
          
          var result = { text: text };
          if (pinning) result.pinnedField = pinning;
          return result;
        });
        
        if (adChanged) {
          Logger.log("  Ad in '" + adGroupName + "' → " + changes.length + " changes:");
          for (var c = 0; c < changes.length; c++) {
            Logger.log(changes[c]);
          }
          
          // Validate before submitting
          var valid = true;
          for (var hi = 0; hi < newHeadlines.length; hi++) {
            if (newHeadlines[hi].text.length > MAX_HEADLINE_CHARS) {
              Logger.log("  ❌ BLOCKED: Headline too long (" + newHeadlines[hi].text.length + "): " + newHeadlines[hi].text);
              valid = false;
            }
          }
          for (var di = 0; di < newDescriptions.length; di++) {
            if (newDescriptions[di].text.length > MAX_DESCRIPTION_CHARS) {
              Logger.log("  ❌ BLOCKED: Description too long (" + newDescriptions[di].text.length + "): " + newDescriptions[di].text);
              valid = false;
            }
          }
          
          if (!valid) {
            errors.push("Ad in '" + campaignName + "/" + adGroupName + "' — blocked due to character limit");
            Logger.log("  ⛔ Skipping this ad due to validation errors");
            continue;
          }
          
          if (!DRY_RUN) {
            // Remove old ad and create new one (Google Ads doesn't allow in-place RSA edits)
            ad.remove();
            
            var builder = adGroup.newAd().responsiveSearchAdBuilder()
              .withFinalUrl(finalUrl)
              .withHeadlines(newHeadlines)
              .withDescriptions(newDescriptions);
            
            // Preserve display path
            var path1 = rsa.getPath1();
            var path2 = rsa.getPath2();
            if (path1) builder = builder.withPath1(path1);
            if (path2) builder = builder.withPath2(path2);
            
            var result = builder.build();
            
            if (result.isSuccessful()) {
              Logger.log("  ✅ Ad updated successfully");
            } else {
              var errMsg = result.getErrors().join(", ");
              Logger.log("  ❌ Error: " + errMsg);
              errors.push("Ad in '" + campaignName + "/" + adGroupName + "': " + errMsg);
            }
          } else {
            Logger.log("  [DRY RUN - no changes made]");
          }
          
          totalAdsUpdated++;
          totalChanges += changes.length;
        } else {
          Logger.log("  No changes needed for ad in '" + adGroupName + "'");
        }
      }
    }
  }
  
  Logger.log("");
  Logger.log("=== SUMMARY ===");
  Logger.log("Ads processed: " + totalAdsUpdated);
  Logger.log("Total changes: " + totalChanges);
  Logger.log("Errors: " + errors.length);
  if (errors.length > 0) {
    for (var e = 0; e < errors.length; e++) {
      Logger.log("  ❌ " + errors[e]);
    }
  }
  Logger.log("Mode: " + (DRY_RUN ? "DRY RUN" : "LIVE"));
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
