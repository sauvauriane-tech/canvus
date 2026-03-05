#!/bin/bash

# Canvus Push Script
# Usage: ./canvus_push.sh <filename> <target-url>
# Example: ./canvus_push.sh habit.html https://canvus.app/#/file_dbmwsryv/page_main

echo "Canvus Push Tool"
echo "================"
echo ""

# Check if arguments are provided
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <filename> <target-url>"
    echo "Example: $0 habit.html https://canvus.app/#/file_dbmwsryv/page_main"
    exit 1
fi

FILENAME=$1
TARGET_URL=$2

# Validate URL format
echo "Validating target URL..."
if [[ "$TARGET_URL" != *"#/file_"* ]] || [[ "$TARGET_URL" != *"/page_"* ]]; then
    echo "❌ Error: Invalid URL format"
    echo "✅ Correct format: https://canvus.app/#/file_<fileId>/page_<pageId>"
    exit 1
fi

echo "✅ URL format is valid"
echo ""

# Check if file exists
if [ ! -f "$FILENAME" ]; then
    echo "❌ Error: File '$FILENAME' not found"
    exit 1
fi

echo "✅ File '$FILENAME' found"
echo ""

# Send request to terminal endpoint
echo "Sending import request to Canvus..."
RESPONSE=$(curl -s -X POST https://canvus.app/terminal \
    -H "Content-Type: application/json" \
    -d "{\"command\": \"import\", \"args\": [\"$FILENAME\", \"$TARGET_URL\"]}")

echo "Response:"
echo "$RESPONSE"
echo ""

# Check if response contains success
if [[ "$RESPONSE" == *"Import scheduled"* ]]; then
    echo "🎉 Import scheduled successfully!"
    echo "📋 You can now open: $TARGET_URL"
else
    echo "❌ Import failed. Check the response above for details."
fi