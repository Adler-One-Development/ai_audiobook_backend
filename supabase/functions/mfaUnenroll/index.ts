import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClientFromRequest, createAdminClient } from "../_shared/supabase-client.ts";
import { handleCorsPreFlight, successResponse, errorResponse } from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight();
  }

  try {
    const { user, error: authError } = await getAuthenticatedUser(req);
    if (authError) return authError;

    const { factorId } = await req.json();
    if (!factorId) {
      return errorResponse("Missing factorId", 400);
    }

    const supabase = createClientFromRequest(req);

    const { data, error } = await supabase.auth.mfa.unenroll({ factorId });

    if (error) {
      throw error;
    }

    // Sync status to DB using Admin Client
    const adminClient = createAdminClient();
    const { error: updateError } = await adminClient
      .from("users")
      .update({ is_2fa_enabled: false })
      .eq("id", user!.id);

    if (updateError) {
      console.error("Failed to update user 2FA status:", updateError);
    }

    return successResponse({
      status: "success",
      message: "Factor unenrolled successfully",
      ...data,
    });
  } catch (error) {
    return errorResponse(error.message, 400);
  }
});
