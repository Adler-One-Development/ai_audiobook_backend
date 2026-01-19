import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { validatePassword } from "../_shared/password-validator.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

interface SetNewPasswordRequest {
    access_token: string;
    full_name: string;
    newPassword: string;
}

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        // Parse request body
        const { access_token, full_name, newPassword }: SetNewPasswordRequest =
            await req.json();

        // Validate input
        if (!access_token || !full_name || !newPassword) {
            return errorResponse(
                "Access token, full name, and new password are required",
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

        // 2. Update the password using the Service Role (Admin)
        const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

        const { error: updateError } = await adminClient.auth.admin
            .updateUserById(
                user.id,
                { password: newPassword },
            );

        if (updateError) {
            console.error("Password update error:", updateError);
            return errorResponse(
                "Failed to set password in system.",
                400,
            );
        }

        // 3. Update the full_name in the users table
        const { error: profileUpdateError } = await adminClient
            .from("users")
            .update({ full_name })
            .eq("id", user.id);

        if (profileUpdateError) {
            console.error("Profile update error:", profileUpdateError);
            return errorResponse(
                "Password set successfully but failed to update profile name.",
                400,
            );
        }

        // Create response
        const response = {
            status: "success" as const,
            message:
                "Password and profile name have been set successfully. You can now log in.",
        };

        return successResponse(response, 200);
    } catch (error) {
        console.error("SetNewPassword error:", error);
        return errorResponse(
            "An error occurred while setting new password",
            500,
        );
    }
});
