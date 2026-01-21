import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import {
    createAdminClient,
    createClientFromRequest,
} from "../_shared/supabase-client.ts";
import { ChangeEmailRequest } from "../_shared/types.ts";

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        // Authenticate user
        const { user, error: authError } = await getAuthenticatedUser(req);
        if (authError || !user) return authError;

        // Parse request body
        const { email } = await req.json() as ChangeEmailRequest;

        if (!email) {
            return errorResponse("Email is required", 400);
        }

        // Check if user has 2FA enabled
        // We use admin client to check the public.users table as the source of truth
        const adminClient = createAdminClient();
        const { data: userData, error: userError } = await adminClient
            .from("users")
            .select("is_2fa_enabled")
            .eq("id", user.id)
            .single();

        if (userError) {
            console.error("Error checking 2FA status:", userError);
            return errorResponse("Failed to verify account status", 500);
        }

        if (userData?.is_2fa_enabled) {
            return errorResponse("Please disable 2FA before changing your email.", 403);
        }

        // Use client scoped to the user to update email
        const authHeader = req.headers.get("Authorization");
        const token = authHeader?.replace("Bearer ", "");

        if (!token) {
            return errorResponse("Missing authorization token", 401);
        }

        const supabase = createClientFromRequest(req);

        // Workaround for "Auth session missing": Manually set the session
        // We provide a dummy refresh token because we only have the access token
        // and updateUser requires a session to be present.
        await supabase.auth.setSession({
            access_token: token,
            refresh_token: "dummy-refresh-token",
        });

        const { data: _updateData, error: updateError } = await supabase.auth
            .updateUser({
                email: email,
            });

        if (updateError) {
            console.error("Change email error:", updateError);
            return errorResponse(updateError.message, 400);
        }

        console.log("Email change initiated successfully for user:", user.id);

        return successResponse(
            {
                status: "success",
                message:
                    "Confirmation link has been sent to your new email address. Please confirm to complete the change.",
            },
            200,
        );
    } catch (error) {
        console.error("Change email error:", error);
        return errorResponse(
            "An error occurred while processing your request",
            500,
        );
    }
});
