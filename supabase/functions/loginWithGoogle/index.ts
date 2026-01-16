import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { createAuthClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        const authClient = createAuthClient();

        // Initiate Google OAuth sign in
        // Redirect URL is controlled by Supabase project's Site URL setting
        const { data, error } = await authClient.auth.signInWithOAuth({
            provider: "google",
        });

        if (error) {
            console.error("Google OAuth error:", error);
            return errorResponse("Failed to initiate Google sign in", 500);
        }

        // Return the OAuth URL for the frontend to redirect to
        const response = {
            status: "success" as const,
            message: "Google OAuth URL generated",
            url: data.url,
        };

        return successResponse(response, 200);
    } catch (error) {
        console.error("Login with Google error:", error);
        return errorResponse("An error occurred during Google sign in", 500);
    }
});
