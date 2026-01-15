import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClientFromRequest } from "../_shared/supabase-client.ts";
import { handleCorsPreFlight, successResponse, errorResponse } from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight();
  }

  try {
    const { error: authError } = await getAuthenticatedUser(req);
    if (authError) return authError;

    const supabase = createClientFromRequest(req);

    const { data: factors, error } = await supabase.auth.mfa.listFactors();

    if (error) {
      throw error;
    }

    return successResponse({
      status: "success",
      message: "Factors listed successfully",
      factors,
    });
  } catch (error) {
    return errorResponse(error.message, 400);
  }
});
