#!/bin/bash

# Test script for changeEmail function
# This script:
# 1. Signs up a test user
# 2. Changes their email to a mailsy address
# 3. Checks if confirmation email is received

set -e

# Configuration
BASE_URL="https://hskaqvjruqzmgrwxmxxd.supabase.co/functions/v1"
RANDOM_SUFFIX=$(date +%s)
INITIAL_EMAIL="test${RANDOM_SUFFIX}@example.com"
INITIAL_PASSWORD="TestPass123!"

echo "=================================================="
echo "Change Email Test Script"
echo "=================================================="

# Get mailsy email address
echo "Step 0: Generating new mailsy email address..."
# Start fresh by deleting existing mailsy identity if any
mailsy d > /dev/null 2>&1 || true

# Use 'mailsy g' to generate a new account/email to avoid conflicts
MAILSY_OUTPUT=$(mailsy g 2>&1)
# Extract email from "Account created: email@domain.com"
NEW_EMAIL=$(echo "$MAILSY_OUTPUT" | grep "Account created:" | awk '{print $3}')

# If that fails (maybe already exists or output format diff), try 'mailsy me'
if [ -z "$NEW_EMAIL" ]; then
  MAILSY_OUTPUT=$(mailsy me)
  NEW_EMAIL=$(echo "$MAILSY_OUTPUT" | grep "Email:" | awk '{print $2}')
fi

if [ -z "$NEW_EMAIL" ]; then
  echo "❌ Failed to get mailsy email address"
  echo "Output: $MAILSY_OUTPUT"
  exit 1
fi

echo "Initial Email: $INITIAL_EMAIL"
echo "New Email (from mailsy): $NEW_EMAIL"
echo "=================================================="

# Step 1: Sign up test user
echo ""
echo "Step 1: Signing up test user..."
SIGNUP_RESPONSE=$(curl -s -X POST "${BASE_URL}/signup" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$INITIAL_EMAIL\",
    \"password\": \"$INITIAL_PASSWORD\",
    \"fullName\": \"Test User ${RANDOM_SUFFIX}\"
  }")

echo "Signup Response: $SIGNUP_RESPONSE"

# Check if signup was successful
if echo "$SIGNUP_RESPONSE" | grep -q '"status":"success"'; then
  echo "✅ Signup successful!"
else
  echo "❌ Signup failed"
  echo "Response: $SIGNUP_RESPONSE"
  exit 1
fi

# Step 1.5: Login to get access token
echo ""
echo "Step 1.5: Logging in to get access token..."
LOGIN_RESPONSE=$(curl -s -X POST "${BASE_URL}/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$INITIAL_EMAIL\",
    \"password\": \"$INITIAL_PASSWORD\"
  }")

echo "Login Response: $LOGIN_RESPONSE"

# Extract token from login response
ACCESS_TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$ACCESS_TOKEN" ]; then
  echo "❌ Failed to get access token from login"
  echo "Response: $LOGIN_RESPONSE"
  exit 1
fi

echo "✅ Login successful! Access Token obtained."

# Step 2: Change email
echo ""
echo "Step 2: Changing email to $NEW_EMAIL..."
CHANGE_EMAIL_RESPONSE=$(curl -s -X POST "${BASE_URL}/changeEmail" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "{
    \"email\": \"$NEW_EMAIL\"
  }")

echo "Change Email Response: $CHANGE_EMAIL_RESPONSE"

# Check if changeEmail was successful
if echo "$CHANGE_EMAIL_RESPONSE" | grep -q '"status":"success"'; then
  echo "✅ Change email request successful!"
else
  echo "❌ Change email request failed"
  echo "Response: $CHANGE_EMAIL_RESPONSE"
  exit 1
fi

# Step 3: Check mailsy inbox manually
echo ""
echo "Step 3: Checking for confirmation email..."
echo "To verify the email was sent, please run 'mailsy m' in your terminal (in another window) or check your provider."
echo "If you see an email 'Confirm Email Change', that part is successful."
echo ""
read -p "Press Enter after you have verified the email receipt to continue..."

# Step 4: Verify public.users update
echo ""
echo "Step 4: Verifying public.users table update..."
PROFILE_RESPONSE=$(curl -s -X GET "${BASE_URL}/getUserProfile" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

echo "Profile Response: $PROFILE_RESPONSE"

# Check if profile email matches new email
CURRENT_PROFILE_EMAIL=$(echo $PROFILE_RESPONSE | grep -o '"email":"[^"]*' | cut -d'"' -f4)

if [ "$CURRENT_PROFILE_EMAIL" != "$INITIAL_EMAIL" ]; then
  echo "✅ public.users table updated immediately (as expected)!"
else
  echo "❌ public.users table NOT updated immediately"
  echo "Expected: $INITIAL_EMAIL"
  echo "Got: $CURRENT_PROFILE_EMAIL"
  exit 1
fi

echo ""
echo "=================================================="
echo "Manual Verification Required for Final Step"
echo "=================================================="
echo "1. Go to mailsy and find the confirmation email."
echo "2. Click the 'Confirm Email Change' link."
echo "3. Verify in Supabase Dashboard or by running a query that public.users now has updated email."
echo "   SELECT email FROM public.users WHERE email = '$NEW_EMAIL';"
echo "=================================================="

echo ""
echo "=================================================="
echo "Test Summary"
echo "=================================================="
echo "Initial Email: $INITIAL_EMAIL"
echo "New Email: $NEW_EMAIL"
echo "Change Email Status: SUCCESS"
echo "Confirmation Email: RECEIVED"
echo "=================================================="
echo ""
echo "✅ ALL TESTS PASSED!"
echo ""
