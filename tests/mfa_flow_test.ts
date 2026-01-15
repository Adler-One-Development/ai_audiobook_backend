import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import * as OTPAuth from "https://deno.land/x/otpauth@v9.1.2/dist/otpauth.esm.min.js";

// Configuration
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

if (!SUPABASE_ANON_KEY) {
  console.error("Please set SUPABASE_ANON_KEY environment variable.");
  Deno.exit(1);
}

const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// Helpers
async function callFunction(
  name: string,
  method: string,
  token: string | null,
  body: any = null,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`; // Override with user token if present
  }

  // If using generic clientFromRequest which looks for Authorization header, we need to be careful.
  // The Edge Functions use `createClientFromRequest(req)` which extracts Bearer token.
  // If we pass Anon Key, it gets Anon client. If we pass User Token, it gets User client.
  // Most MFA functions require User Token.

  const response = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Error calling ${name}: ${JSON.stringify(data)}`);
  }
  return data;
}

// Test State
let accessToken: string;
let user: any;
let factorId: string;
let totpSecret: string;

Deno.test("MFA Flow Test", async (t) => {
  const email = `test_mfa_${Date.now()}@example.com`;
  const password = "SecurePass123!";

  // 1. SignUp New User
  await t.step("SignUp", async () => {
    console.log(`Signing up user: ${email}`);
    const result = await callFunction("signUp", "POST", null, {
      email,
      password,
      firstName: "Test",
      lastName: "User",
    });

    assertExists(result.data.user);
    assertExists(result.data.session);
    user = result.data.user;
    accessToken = result.data.session.access_token;
    console.log("SignUp successful");
  });

  // 2. get2fastatus should be false
  await t.step("Get 2FA Status (Expect False)", async () => {
    const result = await callFunction("get2fastatus", "GET", accessToken);
    // Expecting: { is_2fa_enabled: false } inside the response or similar?
    // Based on implementation, it returns `data: { is_2fa_enabled: boolean }` wrapped in successResponse?
    // Let's inspect response.
    console.log("get2fastatus response:", result);
    // Implementation: return successResponse(userData); -> { status: "success", message: "...", is_2fa_enabled: false }
    assertEquals(result.is_2fa_enabled, false);
  });

  // 3. EnrollmentFlow: enrollMFA (mfaEnrollStart)
  await t.step("Enroll MFA Start", async () => {
    const result = await callFunction(
      "mfaEnrollStart",
      "POST",
      accessToken,
      {},
    );
    console.log("Enroll Start response:", result);
    assertExists(result.id);
    assertExists(result.totp.secret);

    factorId = result.id;
    totpSecret = result.totp.secret;
  });

  // 4. EnrollmentFlow: finalizeMFAEnrollment (mfaEnrollComplete)
  await t.step("Enroll MFA Complete", async () => {
    // Generate TOTP code
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(totpSecret),
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
    const code = totp.generate();

    const result = await callFunction(
      "mfaEnrollComplete",
      "POST",
      accessToken,
      {
        factorId,
        code,
      },
    );
    console.log("Enroll Complete response:", result);
    assertEquals(result.status, "success");
  });

  // 5. Check 2FA Status is now TRUE
  await t.step("Get 2FA Status (Expect True)", async () => {
    // Small delay to ensure DB propagation if using replicas (local is instant)
    const result = await callFunction("get2fastatus", "GET", accessToken);
    console.log("get2fastatus response:", result);
    assertEquals(result.is_2fa_enabled, true);
  });

  // 6. LoginFlow: listFactors (mfaListFactors)
  await t.step("List Factors", async () => {
    const result = await callFunction("mfaListFactors", "GET", accessToken);
    console.log("List Factors response:", result);
    assertExists(result.factors);
    assertEquals(result.factors.length > 0, true);
    const factor = result.factors.find((f: any) => f.id === factorId);
    assertExists(factor);
    assertEquals(factor.status, "verified");
  });

  // 7. LoginFlow: challengeAndVerifyMFA (mfaVerify)
  await t.step("Verify MFA", async () => {
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(totpSecret),
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
    const code = totp.generate();

    const result = await callFunction("mfaVerify", "POST", accessToken, {
      factorId,
      code,
    });
    console.log("Verify Response:", result);
    assertEquals(result.status, "success");
  });

  // 8. UnenrollmentFlow: unenrollMFA (mfaUnenroll)
  await t.step("Unenroll MFA", async () => {
    const result = await callFunction("mfaUnenroll", "DELETE", accessToken, {
      factorId,
    });
    console.log("Unenroll Response:", result);
    assertEquals(result.status, "success");
  });

  // 9. Check 2FA Status is now FALSE
  await t.step("Get 2FA Status (Expect False after Unenroll)", async () => {
    const result = await callFunction("get2fastatus", "GET", accessToken);
    assertEquals(result.is_2fa_enabled, false);
  });
});
