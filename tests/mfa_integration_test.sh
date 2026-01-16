#!/bin/bash
set -e

# Load env if exists
if [ -f .env ]; then
  export $(cat .env | sed 's/#.*//g' | xargs)
fi

# Config
# Use the URL found in openapi.yml
URL="https://hskaqvjruqzmgrwxmxxd.supabase.co/functions/v1"
KEY=$SUPABASE_ANON_KEY

# Generate dynamic test user credentials
TIMESTAMP=$(date +%s)
EMAIL="test_mfa_${TIMESTAMP}@example.com"
PASS="SecurePass123!"
NEW_PASS="NewSecurePass456!"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

if [ -z "$KEY" ]; then
  echo -e "${RED}Error: SUPABASE_ANON_KEY is not set.${NC}"
  echo "Please set it via: export SUPABASE_ANON_KEY=..."
  echo "Or create a .env file in the current directory."
  exit 1
fi

# Helpers
function json_val {
  echo "$1" | deno eval "try { const data = await new Response(Deno.stdin.readable).json(); const val = data.$2; console.log(val ?? ''); } catch (e) { console.log(''); }" 2>/dev/null
}

function gen_totp {
    SECRET=$1
    # Use deno to generate TOTP using the same library as the typescript tests
    deno eval "import * as OTPAuth from 'https://deno.land/x/otpauth@v9.1.2/dist/otpauth.esm.min.js'; const totp = new OTPAuth.TOTP({secret: OTPAuth.Secret.fromBase32('$SECRET'), algorithm: 'SHA1', digits: 6, period: 30}); console.log(totp.generate());"
}

echo "---------------------------------------------------"
echo "Starting MFA Integration Test"
echo "URL: $URL"
echo "Test User: $EMAIL"
echo "---------------------------------------------------"

# 0. SignUp (Always create fresh test user)
echo -n "0. Creating test user... "
SIGNUP_RES=$(curl -s -X POST "$URL/signUp" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"fullName\":\"MFA Test User\"}")

SIGNUP_STATUS=$(json_val "$SIGNUP_RES" "status")

if [ "$SIGNUP_STATUS" != "success" ]; then
    echo -e "${RED}FAILED${NC}"
    echo "Response: $SIGNUP_RES"
    exit 1
fi
echo -e "${GREEN}OK${NC}"

# 1. Login
echo -n "1. Logging in... "
LOGIN_RES=$(curl -s -X POST "$URL/login" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")

TOKEN=$(json_val "$LOGIN_RES" "token")
USER_ID=$(json_val "$LOGIN_RES" "user.id")

if [ -z "$TOKEN" ] || [ "$TOKEN" == "undefined" ]; then
    echo -e "${RED}FAILED${NC}"
    echo "Response: $LOGIN_RES"
    exit 1
fi
echo -e "${GREEN}OK${NC} (User ID: $USER_ID)"

# 2. Enable 2FA
echo -n "2. Enrolling MFA (Start)... "
ENROLL_START=$(curl -s -X POST "$URL/mfaEnrollStart" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{}")

FACTOR_ID=$(json_val "$ENROLL_START" "id")
SECRET=$(json_val "$ENROLL_START" "totp.secret")

if [ -z "$SECRET" ] || [ "$SECRET" == "undefined" ]; then
    echo -e "${RED}FAILED${NC}"
    echo "Response: $ENROLL_START"
    exit 1
fi
echo -e "${GREEN}OK${NC} (Factor ID: $FACTOR_ID)"

echo -n "   Verifying Enrollment... "
CODE=$(gen_totp "$SECRET")
ENROLL_COMPLETE=$(curl -s -X POST "$URL/mfaEnrollComplete" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"factorId\":\"$FACTOR_ID\",\"code\":\"$CODE\"}")

STATUS=$(json_val "$ENROLL_COMPLETE" "status")
if [ "$STATUS" != "success" ]; then
    echo -e "${RED}FAILED${NC}"
    echo "Response: $ENROLL_COMPLETE"
    exit 1
fi
echo -e "${GREEN}OK${NC}"

# 3. Logout
echo -n "3. Logging out... "
curl -s -X POST "$URL/logout" -H "Authorization: Bearer $TOKEN" > /dev/null
echo -e "${GREEN}OK${NC}"

# 4. Login Again (AAL1)
echo -n "4. Logging in again (AAL1)... "
LOGIN2=$(curl -s -X POST "$URL/login" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
TOKEN_AAL1=$(json_val "$LOGIN2" "token")
echo -e "${GREEN}OK${NC}"

# 5. Attempt Change Password (Should Fail)
echo -n "5. Attempting ChangePassword with AAL1 (Expect Failure)... "
CHANGE_RES=$(curl -s -w "%{http_code}" -X POST "$URL/changePassword" \
  -H "Authorization: Bearer $TOKEN_AAL1" \
  -H "Content-Type: application/json" \
  -d "{\"old_password\":\"$PASS\",\"new_password\":\"$NEW_PASS\"}")

HTTP_CODE=${CHANGE_RES: -3}
BODY=${CHANGE_RES::-3}

if [ "$HTTP_CODE" == "200" ]; then
    echo -e "${RED}FAIL${NC}"
    echo "Password check BYPASSED! Request succeeded with AAL1."
    exit 1
else
    echo -e "${GREEN}SUCCESS${NC} (Blocked: $HTTP_CODE)"
fi

# 6. Logout
echo -n "6. Logging out... "
curl -s -X POST "$URL/logout" -H "Authorization: Bearer $TOKEN_AAL1" > /dev/null
echo -e "${GREEN}OK${NC}"

# 7. Login Again
echo -n "7. Logging in again... "
LOGIN3=$(curl -s -X POST "$URL/login" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
TOKEN_TEMP=$(json_val "$LOGIN3" "token")
echo -e "${GREEN}OK${NC}"

# 8. List Factors to get ID
echo -n "8. Listing Factors... "
LIST_RES=$(curl -s -X GET "$URL/mfaListFactors" -H "Authorization: Bearer $TOKEN_TEMP")

# Find the first verified factor
# Needs to access data.factors.all to find the factor
FACTOR_ID_VERIFIED=$(echo "$LIST_RES" | deno eval "const data = await new Response(Deno.stdin.readable).json(); const f = data.factors?.all?.find(f => f.status === 'verified'); console.log(f ? f.id : '');" 2>/dev/null)

if [ -z "$FACTOR_ID_VERIFIED" ]; then
    echo -e "${RED}FAILED${NC}"
    echo "No verified factors found. Response: $LIST_RES"
    exit 1
fi
echo -e "${GREEN}OK${NC} (Factor: $FACTOR_ID_VERIFIED)"

# 9. Verify MFA to get AAL2 Token
echo -n "9. Verifying MFA (Get AAL2 Token)... "
CODE_VERIFY=$(gen_totp "$SECRET")
VERIFY_RES=$(curl -s -X POST "$URL/mfaVerify" \
  -H "Authorization: Bearer $TOKEN_TEMP" \
  -H "Content-Type: application/json" \
  -d "{\"factorId\":\"$FACTOR_ID_VERIFIED\",\"code\":\"$CODE_VERIFY\"}")

TOKEN_AAL2=$(json_val "$VERIFY_RES" "access_token")

if [ -z "$TOKEN_AAL2" ] || [ "$TOKEN_AAL2" == "undefined" ]; then
    echo -e "${RED}FAILED${NC}"
    echo "Did not receive new access_token. Response: $VERIFY_RES"
    exit 1
fi
echo -e "${GREEN}OK${NC}"

# 10. Change Password (Should Succeed)
echo -n "10. Changing Password with AAL2 (Expect Success)... "
CHANGE_RES_2=$(curl -s -w "%{http_code}" -X POST "$URL/changePassword" \
  -H "Authorization: Bearer $TOKEN_AAL2" \
  -H "Content-Type: application/json" \
  -d "{\"old_password\":\"$PASS\",\"new_password\":\"$NEW_PASS\"}")

HTTP_CODE_2=${CHANGE_RES_2: -3}
BODY_2=${CHANGE_RES_2::-3}

if [ "$HTTP_CODE_2" == "200" ]; then
    echo -e "${GREEN}SUCCESS${NC}"
else
    echo -e "${RED}FAILED${NC}"
    echo "Failed with code $HTTP_CODE_2. Response: $BODY_2"
    exit 1
fi

# Update password for subsequent tests
PASS="$NEW_PASS"

# Login again to get fresh token (Change Password invalidates sessions)
echo -n "   Logging in with new password... "
LOGIN_NEW=$(curl -s -X POST "$URL/login" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
TOKEN_NEW=$(json_val "$LOGIN_NEW" "token")

if [ -z "$TOKEN_NEW" ] || [ "$TOKEN_NEW" == "undefined" ]; then
    echo -e "${RED}FAILED${NC} (Could not login with new password)"
    exit 1
fi
echo -e "${GREEN}OK${NC}"

# Verify MFA again to get AAL2 (Unenroll likely requires AAL2)
echo -n "   Verifying MFA again for AAL2... "
CODE_VERIFY_2=$(gen_totp "$SECRET")
VERIFY_RES_2=$(curl -s -X POST "$URL/mfaVerify" \
  -H "Authorization: Bearer $TOKEN_NEW" \
  -H "Content-Type: application/json" \
  -d "{\"factorId\":\"$FACTOR_ID_VERIFIED\",\"code\":\"$CODE_VERIFY_2\"}")

TOKEN_NEW_AAL2=$(json_val "$VERIFY_RES_2" "access_token")

if [ -z "$TOKEN_NEW_AAL2" ] || [ "$TOKEN_NEW_AAL2" == "undefined" ]; then
    echo -e "${RED}FAILED${NC} (Could not get AAL2 token)"
    exit 1
fi
echo -e "${GREEN}OK${NC}"

# 11. Unenroll from MFA
echo -n "11. Unenrolling from MFA... "
UNENROLL_RES=$(curl -s -w "%{http_code}" -X POST "$URL/mfaUnenroll" \
  -H "Authorization: Bearer $TOKEN_NEW_AAL2" \
  -H "Content-Type: application/json" \
  -d "{\"factorId\":\"$FACTOR_ID_VERIFIED\"}")

UNENROLL_HTTP_CODE=${UNENROLL_RES: -3}
UNENROLL_BODY=${UNENROLL_RES::-3}

if [ "$UNENROLL_HTTP_CODE" == "200" ]; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FAILED${NC}"
    echo "Failed with code $UNENROLL_HTTP_CODE. Response: $UNENROLL_BODY"
    exit 1
fi

# 12. Logout
echo -n "12. Logging out... "
curl -s -X POST "$URL/logout" -H "Authorization: Bearer $TOKEN_AAL2" > /dev/null
echo -e "${GREEN}OK${NC}"

# 13. Login and test changePassword (should work without MFA)
echo -n "13. Logging in after MFA unenroll... "
LOGIN_FINAL=$(curl -s -X POST "$URL/login" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")

TOKEN_FINAL=$(json_val "$LOGIN_FINAL" "token")

if [ -z "$TOKEN_FINAL" ] || [ "$TOKEN_FINAL" == "undefined" ]; then
    echo -e "${RED}FAILED${NC}"
    echo "Response: $LOGIN_FINAL"
    exit 1
fi
echo -e "${GREEN}OK${NC}"

echo -n "    Testing ChangePassword with AAL1 (Should Succeed Now)... "
CHANGE_RES_FINAL=$(curl -s -w "%{http_code}" -X POST "$URL/changePassword" \
  -H "Authorization: Bearer $TOKEN_FINAL" \
  -H "Content-Type: application/json" \
  -d "{\"old_password\":\"$PASS\",\"new_password\":\"SecurePass789!\"}")

HTTP_CODE_FINAL=${CHANGE_RES_FINAL: -3}
BODY_FINAL=${CHANGE_RES_FINAL::-3}

if [ "$HTTP_CODE_FINAL" == "200" ]; then
    echo -e "${GREEN}SUCCESS${NC}"
    echo "    Password changed successfully without MFA (as expected after unenroll)"
else
    echo -e "${RED}FAILED${NC}"
    echo "    Failed with code $HTTP_CODE_FINAL. Response: $BODY_FINAL"
    exit 1
fi

echo "---------------------------------------------------"
echo -e "${GREEN}ALL TESTS PASSED${NC}"
echo "---------------------------------------------------"
