import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  errorResponse,
  handleCorsPreFlight,
  successResponse,
} from "../_shared/response-helpers.ts";
import { createClientFromRequest } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight();
  }

  try {
    // Create client with user's token from request
    const supabase = createClientFromRequest(req);

    // Sign out the user (invalidates the session)
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error("Logout error:", error);
      return errorResponse("Failed to logout", 500);
    }

    // Create response
    const response = {
      status: "success" as const,
      message: "Logged out successfully",
    };

    return successResponse(response, 200);
  } catch (error) {
    console.error("Logout error:", error);
    return errorResponse("An error occurred during logout", 500);
  }
});
