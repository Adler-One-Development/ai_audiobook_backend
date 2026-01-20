import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { validatePassword } from "../_shared/password-validator.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import type { ResetPasswordRequest } from "../_shared/types.ts";

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        // Parse request body
        const { access_token, newPassword }: ResetPasswordRequest = await req
            .json();

        // Validate input
        if (!access_token || !newPassword) {
            return errorResponse(
                "Access token and new password are required",
                400,
            );
        }

        // Validate password strength
        const passwordValidation = validatePassword(newPassword);
        if (!passwordValidation.isValid) {
            return errorResponse(
                "Password does not meet requirements",
                400,
                passwordValidation.errors,
            );
        }

        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
        const supabaseServiceRoleKey = Deno.env.get(
            "SUPABASE_SERVICE_ROLE_KEY",
        )!;

        // 1. Verify the provided token matches a valid user
        // We do this by creating a client with the user's token and calling getUser()
        const userClient = createClient(supabaseUrl, supabaseAnonKey, {
            global: {
                headers: { Authorization: `Bearer ${access_token}` },
            },
        });

        const { data: { user }, error: userError } = await userClient.auth
            .getUser();

        if (userError || !user) {
            console.error("Token verification failed:", userError);
            return errorResponse(
                "Invalid or expired access token. Please request a new password reset link.",
                401,
            );
        }

        // 2. Verify new password is not same as old password
        // We attempt to sign in with the new password; if it succeeds, it's the same as the old one.
        const { error: signInError } = await userClient.auth.signInWithPassword(
            {
                email: user.email!,
                password: newPassword,
            },
        );

        if (!signInError) {
            return errorResponse(
                "New password cannot be the same as old password",
                400,
            );
        }

        // 2. Perform the password update using the Service Role (Admin)
        // This is more robust as it doesn't rely on the temporary session context for the update itself
        const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

        const { error: updateError } = await adminClient.auth.admin
            .updateUserById(
                user.id,
                { password: newPassword },
            );

        if (updateError) {
            console.error("Password update error:", updateError);
            return errorResponse(
                "Failed to reset password in system.",
                400,
            );
        }

        // Create response
        const response = {
            status: "success" as const,
            message: "Password has been reset successfully",
        };

        return successResponse(response, 200);
    } catch (error: any) {
        console.error("ResetPassword error:", error);
        return errorResponse("An error occurred while resetting password", 500);
    }
});
