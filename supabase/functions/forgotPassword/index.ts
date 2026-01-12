import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { createAuthClient } from "../_shared/supabase-client.ts";
import type { ForgotPasswordRequest } from "../_shared/types.ts";

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        // Parse request body
        const { email }: ForgotPasswordRequest = await req.json();

        // Validate input
        if (!email) {
            return errorResponse("Email is required", 400);
        }

        // Send password reset email
        const authClient = createAuthClient();
        const { error } = await authClient.auth.resetPasswordForEmail(email, {
            redirectTo: `${req.headers.get("origin")}/reset-password`,
        });

        // Note: We don't reveal if the email exists for security reasons
        // Always return success message
        if (error) {
            console.error("Password reset error:", error);
        }

        // Create response (generic message for security)
        const response = {
            status: "success",
            message:
                "If the email exists in our system, a password reset link has been sent",
        };

        return successResponse(response, 200);
    } catch (error) {
        console.error("ForgotPassword error:", error);
        return errorResponse(
            "An error occurred while processing your request",
            500,
        );
    }
});
