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

        // Create Supabase client with the access token
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
            global: {
                headers: { Authorization: `Bearer ${access_token}` },
            },
        });

        // Verify the token and update password
        const { error } = await supabase.auth.updateUser({
            password: newPassword,
        });

        if (error) {
            console.error("Password reset error:", error);
            return errorResponse(
                "Failed to reset password. The reset link may have expired.",
                400,
            );
        }

        // Create response
        const response = {
            status: "success",
            message: "Password has been reset successfully",
        };

        return successResponse(response, 200);
    } catch (error) {
        console.error("ResetPassword error:", error);
        return errorResponse("An error occurred while resetting password", 500);
    }
});
