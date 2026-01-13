import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import { createClientFromRequest } from "../_shared/supabase-client.ts";
import {
    validatePassword,
    validatePasswordChange,
} from "../_shared/password-validator.ts";

interface ChangePasswordRequest {
    old_password: string;
    new_password: string;
}

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        // Authenticate user
        const { user, error: authError } = await getAuthenticatedUser(req);
        if (authError) return authError;

        // Parse request body
        const { old_password, new_password }: ChangePasswordRequest = await req
            .json();

        // Validate input
        if (!old_password || !new_password) {
            return errorResponse(
                "Old password and new password are required",
                400,
            );
        }

        // Validate that new password is different from old password
        const passwordChangeValidation = validatePasswordChange(
            old_password,
            new_password,
        );
        if (!passwordChangeValidation.isValid) {
            return errorResponse(
                passwordChangeValidation.error ||
                    "New password cannot be the same as old password",
                400,
            );
        }

        // Validate new password strength
        const passwordValidation = validatePassword(new_password);
        if (!passwordValidation.isValid) {
            return errorResponse(
                "New password does not meet requirements",
                400,
                passwordValidation.errors,
            );
        }

        // Verify old password by attempting to sign in with it
        const supabase = createClientFromRequest(req);

        // First, get user's email
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (!currentUser?.email) {
            return errorResponse("User email not found", 404);
        }

        // Create a temporary client to verify old password
        const { createAuthClient } = await import(
            "../_shared/supabase-client.ts"
        );
        const authClient = createAuthClient();
        const { error: signInError } = await authClient.auth.signInWithPassword(
            {
                email: currentUser.email,
                password: old_password,
            },
        );

        if (signInError) {
            return errorResponse("Old password is incorrect", 401);
        }

        // Update password
        const { error: updateError } = await supabase.auth.updateUser({
            password: new_password,
        });

        if (updateError) {
            console.error("Password update error:", updateError);
            return errorResponse("Failed to update password", 500);
        }

        // Create response
        const response = {
            status: "success" as const,
            message: "Password changed successfully",
        };

        return successResponse(response, 200);
    } catch (error) {
        console.error("Change password error:", error);
        return errorResponse("An error occurred while changing password", 500);
    }
});
