import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClientFromRequest } from "../_shared/supabase-client.ts";
import {
  errorResponse,
  handleCorsPreFlight,
  successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";

import { MfaVerifyResponse } from "../_shared/types.ts";

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

    const { data, error } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });

    if (error) {
      throw error;
    }

    return successResponse<MfaVerifyResponse>({
      status: "success",
      message: "Factor challenged and verified successfully",
      access_token: (data as any).session?.access_token,
      refresh_token: (data as any).session?.refresh_token,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return errorResponse(errorMessage, 400);
  }
});
