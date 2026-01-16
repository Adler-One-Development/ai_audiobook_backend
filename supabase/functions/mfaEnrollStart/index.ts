import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClientFromRequest } from "../_shared/supabase-client.ts";
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

    const supabase = createClientFromRequest(req);

    // Cleanup: Remove any existing unverified factors with default friendly name
    // This prevents "factor already exists" errors on repeated enrollment attempts
    const { data: existingFactors } = await supabase.auth.mfa.listFactors();
    
    if (existingFactors?.all) {
      const conflictingFactors = existingFactors.all.filter(
        (f) => f.status === "unverified" && f.friendly_name === ""
      );

      // Unenroll conflicting unverified factors
      await Promise.all(
        conflictingFactors.map((f) =>
          supabase.auth.mfa.unenroll({ factorId: f.id })
        )
      );
    }

    // Create new enrollment
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      issuer: "AI Audiobook",
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
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return errorResponse(errorMessage, 400);
  }
});
