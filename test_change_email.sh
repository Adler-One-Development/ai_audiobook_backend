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

# Step 3: Check mailsy inbox for confirmation email
echo ""
echo "Step 3: Checking mailsy inbox for confirmation email..."
echo "Waiting 5 seconds for email to arrive..."
sleep 5

# Check mailsy inbox using CLI
MAILSY_INBOX=$(mailsy m 2>&1)

echo "Mailsy Inbox:"
echo "$MAILSY_INBOX"
echo ""

# Check if we received any emails
if echo "$MAILSY_INBOX" | grep -q "No Emails"; then
  echo "❌ No confirmation email received yet"
  echo ""
  echo "Waiting 10 more seconds and checking again..."
  sleep 10
  MAILSY_INBOX=$(mailsy m 2>&1)
  echo "Mailsy Inbox (2nd check):"
  echo "$MAILSY_INBOX"
  echo ""
  
  if echo "$MAILSY_INBOX" | grep -q "No Emails"; then
    echo "❌ Still no confirmation email"
    echo ""
    echo "FAILURE: The changeEmail function may not be sending emails correctly"
    exit 1
  else
    echo "✅ Confirmation email received!"
  fi
else
  echo "✅ Confirmation email received!"
fi

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
