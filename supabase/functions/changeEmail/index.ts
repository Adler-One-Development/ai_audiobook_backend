import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";
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

        // Use admin client to update user email (avoids session missing error for Edge Functions)
        const adminClient = createAdminClient();

        const { error: updateError } = await adminClient.auth.admin.updateUserById(
            user.id,
            { email: email }
        );

        if (updateError) {
            console.error("Change email error:", updateError);
            return errorResponse(updateError.message, 400);
        }

        // Update user email in public.users table
        // (adminClient already exists)

        const { error: updatePublicError } = await adminClient
            .from("users")
            .update({    email: email,})
            .eq("id", user.id);

        if (updatePublicError) {
            console.error("Change email error:", updatePublicError);
            return errorResponse(updatePublicError.message, 400);
        }

        return successResponse(
            {
                status: "success",
                message: "Confirmation links have been sent to your new email address. Please confirm to complete the change.",
            },
            200,
        );
    } catch (error) {
        console.error("Change email error:", error);
        return errorResponse("An error occurred while processing your request", 500);
    }
});
