#!/bin/bash

# Configuration
SUPABASE_URL="https://hskaqvjruqzmgrwxmxxd.supabase.co"
BASE_URL="${SUPABASE_URL}/functions/v1"

# Generate random suffix for unique emails
RANDOM_SUFFIX=$(date +%s)
ADMIN_EMAIL="admin${RANDOM_SUFFIX}@example.com"
TARGET_EMAIL="invited${RANDOM_SUFFIX}@example.com"
PASSWORD="SecurePass123!"

echo "=================================================="
echo "Resend Invite Test Script"
echo "=================================================="
echo "Admin Email: $ADMIN_EMAIL"
echo "Target Email: $TARGET_EMAIL"
echo "=================================================="

# Step 1: Sign up Admin
echo ""
echo "Step 1: Signing up Admin..."
SIGNUP_RESPONSE=$(curl -s -X POST "${BASE_URL}/signUp" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$ADMIN_EMAIL\",
    \"password\": \"$PASSWORD\",
    \"fullName\": \"Admin User\"
  }")

if echo "$SIGNUP_RESPONSE" | grep -q '"status":"success"'; then
  echo "✅ Admin signup successful"
else
  echo "❌ Admin signup failed"
  echo "Response: $SIGNUP_RESPONSE"
  exit 1
fi

# Step 2: Login Admin
echo ""
echo "Step 2: Logging in Admin..."
LOGIN_RESPONSE=$(curl -s -X POST "${BASE_URL}/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$ADMIN_EMAIL\",
    \"password\": \"$PASSWORD\"
  }")

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -n "$TOKEN" ]; then
  echo "✅ Admin login successful (Token received)"
else
  echo "❌ Admin login failed"
  echo "Response: $LOGIN_RESPONSE"
  exit 1
fi

# Step 3: Create Invited User
echo ""
echo "Step 3: Creating target user (Invited)..."
CREATE_RESPONSE=$(curl -s -X POST "${BASE_URL}/createUser" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"emails\": [\"$TARGET_EMAIL\"],
    \"role\": \"MEMBER\"
  }")

if echo "$CREATE_RESPONSE" | grep -q '"status":"success"'; then
  echo "✅ Target user created successfully"
  # Extract User ID
  USER_ID=$(echo "$CREATE_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "User ID: $USER_ID"
else
  echo "❌ Target user creation failed"
  echo "Response: $CREATE_RESPONSE"
  exit 1
fi

# Step 4: Resend Invite
echo ""
echo "Step 4: Resending invite..."
RESEND_RESPONSE=$(curl -s -X POST "${BASE_URL}/resendInvite" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"user_id\": \"$USER_ID\"
  }")

echo "Response: $RESEND_RESPONSE"

if echo "$RESEND_RESPONSE" | grep -q '"status":"success"'; then
  echo "✅ Invite resent successfully"
  
  # Verify new User ID is different
  NEW_USER_ID=$(echo "$RESEND_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "New User ID: $NEW_USER_ID"
  
  if [ "$USER_ID" != "$NEW_USER_ID" ]; then
    echo "✅ Verified: User ID has changed (User was recreated)"
  else
    echo "⚠️ Warning: User ID is the same (Did functionality change?)"
  fi
  
else
  echo "❌ Resend invite failed"
  exit 1
fi
