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

    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
    });

    if (error) {
        throw error;
    }

    return successResponse({
      status: "success",
      message: "Enrollment initiated successfully",
      ...data,
    });
  } catch (error) {
    return errorResponse(error.message, 400);
  }
});
