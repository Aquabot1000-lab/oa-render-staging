#!/bin/bash
# Value Monitor — Daily cron script
# Run at 8 AM CT daily starting April 1
# 
# Cron setup (add via: crontab -e):
#   0 8 * * * /Users/aquabot/Documents/OverAssessed/server/services/run-value-monitor.sh >> /Users/aquabot/Documents/OverAssessed/server/logs/value-monitor.log 2>&1
#
# Or via launchd (recommended for macOS):
#   See com.overassessed.value-monitor.plist

cd /Users/aquabot/Documents/OverAssessed/server

echo ""
echo "=========================================="
echo "Value Monitor Run: $(date)"
echo "=========================================="

# Run the value monitor
/opt/homebrew/bin/node services/value-monitor.js

echo "Completed: $(date)"
