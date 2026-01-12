import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { createAuthClient } from "../_shared/supabase-client.ts";
import type {
    RefreshTokenRequest,
    RefreshTokenResponse,
} from "../_shared/types.ts";

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        // Parse request body
        const { refreshToken }: RefreshTokenRequest = await req.json();

        // Validate input
        if (!refreshToken) {
            return errorResponse("Refresh token is required", 400);
        }

        // Refresh session with Supabase Auth
        const authClient = createAuthClient();
        const { data, error } = await authClient.auth.refreshSession({
            refresh_token: refreshToken,
        });

        if (error || !data.session) {
            return errorResponse("Invalid or expired refresh token", 401);
        }

        // Create response
        const response: RefreshTokenResponse = {
            status: "success",
            message: "Token refreshed successfully",
            token: data.session.access_token,
            refreshToken: data.session.refresh_token,
            expiresIn: data.session.expires_in || 3600,
        };

        return successResponse(response, 200);
    } catch (error) {
        console.error("RefreshToken error:", error);
        return errorResponse("An error occurred while refreshing token", 500);
    }
});
