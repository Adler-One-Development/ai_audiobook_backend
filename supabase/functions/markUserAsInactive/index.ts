import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";

interface MarkUserAsInactiveRequest {
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
        const { userId }: MarkUserAsInactiveRequest = await req.json();

        // Validate input
        if (!userId) {
            return errorResponse("userId is required", 400);
        }

        // Cannot mark yourself as inactive
        if (userId === user!.id) {
            return errorResponse("You cannot mark yourself as inactive", 403);
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

        // Get organization to check ownership
        const { data: org, error: orgError } = await adminClient
            .from("organizations")
            .select("owner_id")
            .eq("id", requestingUser.organization_id)
            .single();

        if (orgError || !org) {
            return errorResponse("Organization not found", 404);
        }

        // Cannot mark organization owner as inactive
        if (userId === org.owner_id) {
            return errorResponse(
                "The organization owner cannot be marked as inactive",
                403,
            );
        }

        // Role-based permissions (similar to deleteUser)
        const requestorRole = requestingUser.user_type;

        // MEMBER can't mark anyone as inactive
        if (requestorRole === "MEMBER") {
            return errorResponse("Members cannot mark users as inactive", 403);
        }

        // OWNER can't mark ADMIN as inactive (same rule as deleteUser)
        if (requestorRole === "OWNER" && targetUser.user_type === "ADMIN") {
            return errorResponse(
                "Owners cannot mark Admins as inactive",
                403,
            );
        }

        // Mark user as inactive
        const { error: updateError } = await adminClient
            .from("users")
            .update({ is_active: false })
            .eq("id", userId);

        if (updateError) {
            console.error("Mark user as inactive error:", updateError);
            return errorResponse("Failed to mark user as inactive", 500);
        }

        // Create response
        const response = {
            status: "success" as const,
            message: "User marked as inactive successfully",
        };

        return successResponse(response, 200);
    } catch (error) {
        console.error("Mark user as inactive error:", error);
        return errorResponse(
            "An error occurred while marking user as inactive",
            500,
        );
    }
});
