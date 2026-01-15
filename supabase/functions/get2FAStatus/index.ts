import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";
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
    const { user, error: authError } = await getAuthenticatedUser(req, {
      skipMfaCheck: true,
    });
    if (authError) return authError;

    const supabase = createAdminClient();

    // Query users table for 2FA status
    const { data: userData, error: dbError } = await supabase
      .from("users")
      .select("is_2fa_enabled")
      .eq("id", user!.id)
      .single();

    if (dbError) {
      console.error("Error fetching 2FA status:", dbError);
      return errorResponse("Could not retrieve user data", 500);
    }

    return successResponse({ is2FAEnabled: userData?.is_2fa_enabled ?? false });
  } catch (error) {
    return errorResponse(error.message, 400);
  }
});
