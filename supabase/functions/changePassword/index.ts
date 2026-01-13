import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import {
    createAdminClient,
    createAuthClient,
} from "../_shared/supabase-client.ts";
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
        const { user: _user, error: authError } = await getAuthenticatedUser(
            req,
        );
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

        // Get user from the JWT token
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return errorResponse("Authorization header required", 401);
        }

        const token = authHeader.replace("Bearer ", "");
        const authClient = createAuthClient();

        // Get user details from token
        const { data: { user }, error: getUserError } = await authClient.auth
            .getUser(token);

        if (getUserError || !user?.email) {
            return errorResponse("Failed to get user details", 401);
        }

        // Verify old password by attempting to sign in
        const { error: signInError } = await authClient.auth.signInWithPassword(
            {
                email: user.email,
                password: old_password,
            },
        );

        if (signInError) {
            return errorResponse("Old password is incorrect", 401);
        }

        // Update password using admin client
        const adminClient = createAdminClient();
        const { error: updateError } = await adminClient.auth.admin
            .updateUserById(
                user.id,
                { password: new_password },
            );

        if (updateError) {
            console.error("Password update error:", updateError);
            return errorResponse("Failed to update password", 500);
        }

        // Get new tokens by signing in with new password
        const { data: authData, error: newAuthError } = await authClient.auth
            .signInWithPassword({
                email: user.email,
                password: new_password,
            });

        if (newAuthError || !authData.session) {
            console.error("Failed to get new tokens:", newAuthError);
            return errorResponse(
                "Password updated but failed to generate new tokens",
                500,
            );
        }

        // Create response with new tokens
        const response = {
            status: "success" as const,
            message: "Password changed successfully",
            token: authData.session.access_token,
            refreshToken: authData.session.refresh_token,
            expiresIn: authData.session.expires_in || 3600,
        };

        return successResponse(response, 200);
    } catch (error) {
        console.error("Change password error:", error);
        return errorResponse("An error occurred while changing password", 500);
    }
});
