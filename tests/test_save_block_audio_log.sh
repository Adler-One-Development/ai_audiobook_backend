#!/bin/bash

# Configuration
SUPABASE_URL="https://hskaqvjruqzmgrwxmxxd.supabase.co"
PROJECT_ID="610e2401-a2f7-47e1-b96a-ac6dc976bd64"
STUDIO_ID="PhCcwfkVN359j7Ktkszc"
CHAPTER_ID="SW33iI9Whtofpt78qu8h"
BLOCK_ID="28LYWXv8PaCicsye4FwL"
ACCESS_TOKEN="eyJhbGciOiJFUzI1NiIsImtpZCI6IjFmYWY5N2IyLTM4NjQtNDQwZi1hNGE1LTQ3MmE2MzI1OTdjMCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2hza2FxdmpydXF6bWdyd3hteHhkLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiI3YWQyMDFhZS1iY2M1LTRhYWUtOWQ0Yy02Y2NiZjM2MGFhMDgiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzcwOTIwMjE3LCJpYXQiOjE3NzA5MTY2MTcsImVtYWlsIjoibmxhemFydXNAdGV4YXNncm93dGhmYWN0b3J5LmNvbSIsInBob25lIjoiIiwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiZW1haWwiLCJwcm92aWRlcnMiOlsiZW1haWwiXX0sInVzZXJfbWV0YWRhdGEiOnsiZW1haWwiOiJubGF6YXJ1c0B0ZXhhc2dyb3d0aGZhY3RvcnkuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsInBob25lX3ZlcmlmaWVkIjpmYWxzZSwic3ViIjoiN2FkMjAxYWUtYmNjNS00YWFlLTlkNGMtNmNjYmYzNjBhYTA4In0sInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiYWFsIjoiYWFsMSIsImFtciI6W3sibWV0aG9kIjoicGFzc3dvcmQiLCJ0aW1lc3RhbXAiOjE3NzA5MTY2MTd9XSwic2Vzc2lvbl9pZCI6ImI2NWYyOWViLTVlYzYtNDg3MS1hNTlkLWFmMWFjNGRiMGI1MSIsImlzX2Fub255bW91cyI6ZmFsc2V9.WeohwIt3F7z4RczcYiVutYBSMi5SnYebF14YjuelawsfH54uMHq_N_9tEmT-hSCWY0p7m5HBUuwQ7NN--L5akw"

# Endpoint
URL="$SUPABASE_URL/functions/v1/saveBlockAudioLog"

echo "Testing saveBlockAudioLog..."
echo "URL: $URL"

# Sample JSON for block_snapshot
BLOCK_SNAPSHOT='{
  "nodes": [
    {
      "text": "The stars began to pierce through the gathering gloom as the small party reached the edge of the Shire.",
      "type": "tts_node",
      "voice_id": "9dgn8QSxG799oIPKzPx8"
    },
    {
      "text": " It’s the Arctic, Barnaby!",
      "type": "tts_node",
      "voice_id": "hpp4J3VqNfWAUOO0d1Us"
    },
    {
      "text": " Bella laughed, tossing a snowball that landed with a pliff on Barnaby’s nose.",
      "type": "tts_node",
      "voice_id": "hpp4J3VqNfWAUOO0d1Us"
    },
    {
      "text": " It’s supposed to be freezing. That’s the best part!",
      "type": "tts_node",
      "voice_id": "hpp4J3VqNfWAUOO0d1Us"
    }            
  ],
  "block_id": "'$BLOCK_ID'" 
}'

echo "Sending Payload..."

curl -X POST "$URL" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "project_id=$PROJECT_ID" \
  -F "studio_id=$STUDIO_ID" \
  -F "chapter_id=$CHAPTER_ID" \
  -F "block_id=$BLOCK_ID" \
  -F "block_snapshot=$BLOCK_SNAPSHOT"

echo -e "\n\nDone."
