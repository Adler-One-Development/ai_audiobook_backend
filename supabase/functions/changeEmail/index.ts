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

        const { data: updateData, error: updateError } = await supabase.auth
            .updateUser({
                email: email,
            });

        if (updateError) {
            console.error("Change email error:", updateError);
            return errorResponse(updateError.message, 400);
        }

        console.log("Email change initiated successfully for user:", user.id);

        // Update user email in public.users table
        const adminClient = createAdminClient();

        const { error: updatePublicError } = await adminClient
            .from("users")
            .update({ email: email })
            .eq("id", user.id);

        if (updatePublicError) {
            console.error("Change email error:", updatePublicError);
            return errorResponse(updatePublicError.message, 400);
        }

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
