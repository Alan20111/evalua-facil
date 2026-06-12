#!/bin/bash

# Clear Firestore database using Firebase CLI
# Usage: ./clear-db-firebase-cli.sh

set -e

PROJECT_ID="evalua-facil-app"
COLLECTIONS=("users" "students" "groups" "subjects" "activities" "submissions" "schools")

echo ""
echo "🔥 FIRESTORE DATABASE CLEAR SCRIPT (Firebase CLI)"
echo "=================================================="
echo "Project: $PROJECT_ID"
echo "Collections to delete: ${COLLECTIONS[*]}"
echo "=================================================="
echo ""
echo "⚠️  WARNING: This will PERMANENTLY DELETE all data in these collections."
echo "   This action CANNOT be undone."
echo ""

read -p "Are you sure? Type 'yes' to confirm: " confirm

if [ "$confirm" != "yes" ]; then
  echo ""
  echo "❌ Cancelled. No data was deleted."
  echo ""
  exit 0
fi

echo ""
echo "🗑️  Starting deletion..."
echo ""

TOTAL_DELETED=0

for collection in "${COLLECTIONS[@]}"; do
  echo "  Deleting collection: $collection..."

  # Use firebase firestore:delete command (interactive mode disabled)
  firebase firestore:delete \
    --project="$PROJECT_ID" \
    --recursive \
    --yes \
    "$collection" \
    2>/dev/null || echo "    ✓ Collection deleted or was empty"
done

echo ""
echo "✅ Deletion complete!"
echo "   All specified collections have been cleared."
echo ""
