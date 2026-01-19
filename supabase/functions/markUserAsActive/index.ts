import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";

interface MarkUserAsActiveRequest {
    userId: string;
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
        const { userId }: MarkUserAsActiveRequest = await req.json();

        // Validate input
        if (!userId) {
            return errorResponse("userId is required", 400);
        }

        const adminClient = createAdminClient();

        // Get requesting user's information
        const { data: requestingUser, error: reqUserError } = await adminClient
            .from("users")
            .select("user_type, organization_id")
            .eq("id", user!.id)
            .single();

        if (reqUserError || !requestingUser) {
            return errorResponse("Failed to get user information", 404);
        }

        // Get target user's information
        const { data: targetUser, error: targetUserError } = await adminClient
            .from("users")
            .select("user_type, organization_id")
            .eq("id", userId)
            .single();

        if (targetUserError || !targetUser) {
            return errorResponse("Target user not found", 404);
        }

        // Check same organization
        if (requestingUser.organization_id !== targetUser.organization_id) {
            return errorResponse(
                "You can only manage users from your organization",
                403,
            );
        }

        // Role-based permissions
        const requestorRole = requestingUser.user_type;

        // MEMBER can't activate anyone
        if (requestorRole === "MEMBER") {
            return errorResponse("Members cannot activate users", 403);
        }

        // OWNER can't activate ADMIN (same rule as deactivation for consistency)
        if (requestorRole === "OWNER" && targetUser.user_type === "ADMIN") {
            return errorResponse(
                "Owners cannot activate Admins",
                403,
            );
        }

        // Mark user as active
        const { error: updateError } = await adminClient
            .from("users")
            .update({ is_active: true })
            .eq("id", userId);

        if (updateError) {
            console.error("Mark user as active error:", updateError);
            return errorResponse("Failed to mark user as active", 500);
        }

        // Create response
        const response = {
            status: "success" as const,
            message: "User marked as active successfully",
        };

        return successResponse(response, 200);
    } catch (error) {
        console.error("Mark user as active error:", error);
        return errorResponse(
            "An error occurred while marking user as active",
            500,
        );
    }
});
