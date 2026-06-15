#!/bin/bash
set -e

PROJECT="evalua-facil-app"
COLLECTIONS=("payments" "subscriptions" "plans" "users" "students" "groups" "subjects" "activities" "submissions" "schools" "attendance")

echo ""
echo "🔥 FORCE CLEAR ALL COLLECTIONS"
echo "==============================="

for col in "${COLLECTIONS[@]}"; do
  echo "Clearing: $col"
  firebase firestore:delete --project="$PROJECT" --recursive --yes "$col" 2>&1 | grep -v "^$" || true
  sleep 1
done

echo ""
echo "✅ All collections cleared!"
echo ""
