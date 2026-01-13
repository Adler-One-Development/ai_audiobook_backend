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

        // Get the redirect URL from request or use default
        const { redirect_to } = await req.json().catch(() => ({
            redirect_to: null,
        }));
        const redirectUrl = redirect_to ||
            `${
                req.headers.get("origin") || "http://localhost:3000"
            }/auth/callback`;

        // Initiate Google OAuth sign up
        const { data, error } = await authClient.auth.signInWithOAuth({
            provider: "google",
            options: {
                redirectTo: redirectUrl,
            },
        });

        if (error) {
            console.error("Google OAuth error:", error);
            return errorResponse("Failed to initiate Google sign up", 500);
        }

        // Return the OAuth URL for the frontend to redirect to
        const response = {
            status: "success" as const,
            message: "Google OAuth URL generated",
            url: data.url,
        };

        return successResponse(response, 200);
    } catch (error) {
        console.error("Sign up with Google error:", error);
        return errorResponse("An error occurred during Google sign up", 500);
    }
});
