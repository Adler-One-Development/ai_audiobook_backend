#!/bin/bash

# Configuration
API_URL="https://hskaqvjruqzmgrwxmxxd.supabase.co/functions/v1/getAllVoices"

# Check for arguments
if [ "$#" -lt 2 ]; then
    echo "Usage: $0 <xi_api_key> <access_token> [supabase_anon_key]"
    exit 1
fi

XI_API_KEY=$1
ACCESS_TOKEN=$2
SUPABASE_ANON_KEY=${3:-"dummy-anon-key"}

echo "Testing getAllVoices API..."
echo "ElevenLabs API Key: ${XI_API_KEY:0:5}..."
echo "Access Token: ${ACCESS_TOKEN:0:10}..."

curl -i -X POST "$API_URL" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "xi-api-key: $XI_API_KEY"

echo -e "\n\nDone."
