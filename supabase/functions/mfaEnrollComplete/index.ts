import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  createAdminClient,
  createClientFromRequest,
} from "../_shared/supabase-client.ts";
import {
  errorResponse,
  handleCorsPreFlight,
  successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight();
  }

  try {
    const { error: authError } = await getAuthenticatedUser(req, {
      skipMfaCheck: true,
    });
    if (authError) return authError;

    const { factorId, code } = await req.json();
    if (!factorId || !code) {
      return errorResponse("Missing factorId or code", 400);
    }

    const supabase = createClientFromRequest(req);

    // Challenge
    const { data: challengeData, error: challengeError } = await supabase.auth
      .mfa.challenge({ factorId });

    if (challengeError) {
      throw challengeError;
    }

    // Verify
    const { data: verifyData, error: verifyError } = await supabase.auth.mfa
      .verify({
        factorId,
        challengeId: challengeData.id,
        code,
      });

    if (verifyError) {
      throw verifyError;
    }

    // Sync status to DB using Admin Client
    const adminClient = createAdminClient();
    const { error: updateError } = await adminClient
      .from("users")
      .update({ is_2fa_enabled: true })
      .eq("id", user!.id);

    if (updateError) {
      console.error("Failed to update user 2FA status:", updateError);
    }

    return successResponse({
      status: "success",
      message: "Enrollment finalized successfully",
      ...verifyData,
    });
  } catch (error) {
    return errorResponse(error.message, 400);
  }
});
