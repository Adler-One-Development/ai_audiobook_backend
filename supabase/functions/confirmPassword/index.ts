import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import { createAuthClient } from "../_shared/supabase-client.ts";

interface ConfirmPasswordRequest {
    password: string;
}

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        // Authenticate requesting user
        const { user, error: authError } = await getAuthenticatedUser(req);
        if (authError) return authError;

        // Parse request body
        const { password }: ConfirmPasswordRequest = await req.json();

        // Validate input
        if (!password) {
            return errorResponse("password is required", 400);
        }

        const authClient = createAuthClient();

        // Verify password by attempting to sign in
        const { data, error: signInError } = await authClient.auth
            .signInWithPassword({
                email: user!.email!,
                password: password,
            });

        if (signInError || !data.user) {
            // Password is incorrect
            return errorResponse("Incorrect password", 401);
        }

        // Password is correct
        const response = {
            status: "success" as const,
            message: "Password confirmed successfully",
        };

        return successResponse(response, 200);
    } catch (error) {
        console.error("Confirm password error:", error);
        return errorResponse(
            "An error occurred while confirming password",
            500,
        );
    }
});
