#!/bin/sh
# Rebuilds daily-summary/index.ts from ../logic.js so the app and the morning notification share one scheduler.
cd "$(dirname "$0")"
{
  echo "// @ts-nocheck"
  echo "// Leaflog \"daily-summary\": sends the morning push notification listing what's due."
  echo "// This file is generated from logic.js + daily-summary.body.ts (run build.sh). Paste the whole thing into Supabase."
  echo
  echo "/* ---------------------------------------------------- scheduling logic (from logic.js) */"
  sed 's/^export //' ../logic.js
  cat daily-summary.body.ts
} > daily-summary/index.ts
echo "built daily-summary/index.ts"
