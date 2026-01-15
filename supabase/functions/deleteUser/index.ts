import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";

interface DeleteUserRequest {
    user_id: string;
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
        const { user_id }: DeleteUserRequest = await req.json();

        // Validate input
        if (!user_id) {
            return errorResponse("user_id is required", 400);
        }

        // Cannot delete yourself
        if (user_id === user!.id) {
            return errorResponse("You cannot delete yourself", 403);
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
            .eq("id", user_id)
            .single();

        if (targetUserError || !targetUser) {
            return errorResponse("Target user not found", 404);
        }

        // Check same organization
        if (requestingUser.organization_id !== targetUser.organization_id) {
            return errorResponse(
                "You can only delete users from your organization",
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

        // Check if target is the owner
        if (user_id === org.owner_id) {
            return errorResponse(
                "The organization owner cannot be deleted",
                403,
            );
        }

        // Role-based deletion rules
        const requestorRole = requestingUser.user_type;
        const targetRole = targetUser.user_type;

        // MEMBER can't delete anyone
        if (requestorRole === "MEMBER") {
            return errorResponse("Members cannot delete users", 403);
        }

        // OWNER can't delete ADMIN
        if (requestorRole === "OWNER" && targetRole === "ADMIN") {
            return errorResponse("Owners cannot delete Admins", 403);
        }

        // MEMBER can't delete OWNER or ADMIN (already covered above, but explicit)
        if (
            requestorRole === "MEMBER" &&
            (targetRole === "OWNER" || targetRole === "ADMIN")
        ) {
            return errorResponse("Members cannot delete Owners or Admins", 403);
        }

        // Remove user from organization member_ids
        const { error: removeError } = await adminClient.rpc(
            "remove_organization_member",
            {
                org_id: requestingUser.organization_id,
                user_id: user_id,
            },
        );

        if (removeError) {
            console.error(
                "Failed to remove user from organization:",
                removeError,
            );
        }

        // Delete user from users table
        const { error: deleteUserError } = await adminClient
            .from("users")
            .delete()
            .eq("id", user_id);

        if (deleteUserError) {
            console.error("User deletion error:", deleteUserError);
            return errorResponse("Failed to delete user", 500);
        }

        // Delete user from auth
        const { error: deleteAuthError } = await adminClient.auth.admin
            .deleteUser(user_id);

        if (deleteAuthError) {
            console.error("Auth deletion error:", deleteAuthError);
            return errorResponse("Failed to delete user authentication", 500);
        }

        // Create response
        const response = {
            status: "success" as const,
            message: "User deleted successfully",
        };

        return successResponse(response, 200);
    } catch (error) {
        console.error("Delete user error:", error);
        return errorResponse("An error occurred while deleting user", 500);
    }
});
