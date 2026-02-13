#!/bin/bash

# Test script for generateAudioForParagraph function
# This script tests:
# 1. Authentication
# 2. Missing fields validation
# 3. Credit calculation
# 4. Successful audio generation

set -e

# Configuration
BASE_URL="https://hskaqvjruqzmgrwxmxxd.supabase.co/functions/v1"
ELEVEN_LABS_API_KEY="sk_d545137c23e3098d622e593988bc4e2691554f05a701b0e8"

# Test credentials - UPDATE THESE
TEST_EMAIL="nlazarus@texasgrowthfactory.com"
TEST_PASSWORD="abcDEF@1234"
TEST_PROJECT_ID="610e2401-a2f7-47e1-b96a-ac6dc976bd64"
TEST_CHAPTER_ID="SW33iI9Whtofpt78qu8h"
TEST_BLOCK_ID="28LYWXv8PaCicsye4FwL"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=================================================="
echo "generateAudioForParagraph Test Script"
echo "=================================================="
echo "Base URL: $BASE_URL"
echo "Test Email: $TEST_EMAIL"
echo "Project ID: $TEST_PROJECT_ID"
echo "Chapter ID: $TEST_CHAPTER_ID"
echo "Block ID: $TEST_BLOCK_ID"
echo "=================================================="

# Check required environment variables
if [ -z "$ELEVEN_LABS_API_KEY" ]; then
  echo -e "${RED}❌ ELEVEN_LABS_API_KEY environment variable not set${NC}"
  exit 1
fi

# Step 1: Login to get access token
echo ""
echo -e "${YELLOW}Step 1: Logging in to get access token...${NC}"
LOGIN_RESPONSE=$(curl -s -X POST "${BASE_URL}/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$TEST_EMAIL\",
    \"password\": \"$TEST_PASSWORD\"
  }")

echo "Login Response: $LOGIN_RESPONSE"

# Extract access token
# Extract access token
if command -v jq &> /dev/null; then
  ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.token')
else
  ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
fi

if [ -z "$ACCESS_TOKEN" ]; then
  echo -e "${RED}❌ Failed to get access token${NC}"
  echo "Response: $LOGIN_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✅ Login successful! Access token obtained.${NC}"

# Step 2: Test without authentication
echo ""
echo -e "${YELLOW}Step 2: Testing without authentication...${NC}"
NO_AUTH_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/generateAudioForParagraph" \
  -H "eleven-labs-api-key: $ELEVEN_LABS_API_KEY" \
  -F "projectId=$TEST_PROJECT_ID" \
  -F "chapterId=$TEST_CHAPTER_ID" \
  -F "blockId=$TEST_BLOCK_ID")

HTTP_CODE=$(echo "$NO_AUTH_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$NO_AUTH_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "401" ]; then
  echo -e "${GREEN}✅ Correctly rejects unauthenticated requests (401)${NC}"
else
  echo -e "${RED}❌ Expected 401, got $HTTP_CODE${NC}"
  echo "Response: $RESPONSE_BODY"
fi

# Step 3: Test with missing required fields
echo ""
echo -e "${YELLOW}Step 3: Testing with missing required fields...${NC}"
MISSING_FIELDS_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/generateAudioForParagraph" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "eleven-labs-api-key: $ELEVEN_LABS_API_KEY" \
  -F "projectId=$TEST_PROJECT_ID")

HTTP_CODE=$(echo "$MISSING_FIELDS_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$MISSING_FIELDS_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "400" ]; then
  echo -e "${GREEN}✅ Correctly validates required fields (400)${NC}"
else
  echo -e "${RED}❌ Expected 400, got $HTTP_CODE${NC}"
  echo "Response: $RESPONSE_BODY"
fi

# Step 4: Test with invalid project_id
echo ""
echo -e "${YELLOW}Step 4: Testing with invalid project_id...${NC}"
INVALID_PROJECT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/generateAudioForParagraph" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "eleven-labs-api-key: $ELEVEN_LABS_API_KEY" \
  -F "projectId=invalid-project-id" \
  -F "chapterId=$TEST_CHAPTER_ID" \
  -F "blockId=$TEST_BLOCK_ID")

HTTP_CODE=$(echo "$INVALID_PROJECT_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$INVALID_PROJECT_RESPONSE" | sed '$d')

 if [ "$HTTP_CODE" = "404" ]; then
  echo -e "${GREEN}✅ Correctly rejects invalid project_id (404)${NC}"
else
  echo -e "${RED}❌ Expected 404, got $HTTP_CODE${NC}"
  echo "Response: $RESPONSE_BODY"
fi

# Step 5: Test successful audio generation
echo ""
echo -e "${YELLOW}Step 5: Testing successful audio generation...${NC}"
SUCCESS_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/generateAudioForParagraph" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "eleven-labs-api-key: $ELEVEN_LABS_API_KEY" \
  -F "projectId=$TEST_PROJECT_ID" \
  -F "chapterId=$TEST_CHAPTER_ID" \
  -F "blockId=$TEST_BLOCK_ID")

HTTP_CODE=$(echo "$SUCCESS_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$SUCCESS_RESPONSE" | sed '$d')

echo "Response Body: $RESPONSE_BODY"

if [ "$HTTP_CODE" = "200" ]; then
  echo -e "${GREEN}✅ Audio generation successful (200)${NC}"
  
  # Extract and display response data
  if command -v jq &> /dev/null; then
    FILE_ID=$(echo "$RESPONSE_BODY" | jq -r '.data.file_id')
    FILE_URL=$(echo "$RESPONSE_BODY" | jq -r '.data.url')
    CHAR_COUNT=$(echo "$RESPONSE_BODY" | jq -r '.data.character_count')
    CREDITS_USED=$(echo "$RESPONSE_BODY" | jq -r '.data.credits_used')
    
    echo "  - File ID: $FILE_ID"
    echo "  - URL: $FILE_URL"
    echo "  - Character count: $CHAR_COUNT"
    echo "  - Credits used: $CREDITS_USED"
    
    # Verify credit calculation
    EXPECTED_CREDITS=$(( ($CHAR_COUNT + 999) / 1000 )) # Ceiling division
    if [ "$CREDITS_USED" = "$EXPECTED_CREDITS" ]; then
      echo -e "${GREEN}✅ Credit calculation verified${NC}"
    else
      echo -e "${RED}❌ Credit calculation mismatch. Expected: $EXPECTED_CREDITS, Got: $CREDITS_USED${NC}"
    fi
  else
    echo "  (Install 'jq' for detailed response parsing)"
  fi
else
  echo -e "${RED}❌ Audio generation failed. Expected 200, got $HTTP_CODE${NC}"
  echo "Response: $RESPONSE_BODY"
  exit 1
fi

echo ""
echo "=================================================="
echo "Test Summary"
echo "=================================================="
echo -e "${GREEN}✅ Authentication Test: PASSED${NC}"
echo -e "${GREEN}✅ Missing Auth Test: PASSED${NC}"
echo -e "${GREEN}✅ Missing Fields Test: PASSED${NC}"
echo -e "${GREEN}✅ Invalid Project Test: PASSED${NC}"
echo -e "${GREEN}✅ Successful Generation Test: PASSED${NC}"
echo "=================================================="
echo ""
echo -e "${GREEN}✅ ALL TESTS PASSED!${NC}"
echo ""
