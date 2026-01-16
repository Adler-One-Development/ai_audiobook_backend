import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";

interface ChangeUserTypeRequest {
    id: string;
    userType: "ADMIN" | "MEMBER" | "OWNER";
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
        const { id, userType }: ChangeUserTypeRequest = await req.json();

        // Validate input
        if (!id) {
            return errorResponse("id is required", 400);
        }

        if (!userType || !["ADMIN", "MEMBER", "OWNER"].includes(userType)) {
            return errorResponse(
                "userType is required and must be ADMIN, MEMBER, or OWNER",
                400,
            );
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

        // Get organization to check ownership
        const { data: org, error: orgError } = await adminClient
            .from("organizations")
            .select("owner_id")
            .eq("id", requestingUser.organization_id)
            .single();

        if (orgError || !org) {
            return errorResponse("Organization not found", 404);
        }

        // Cannot change own userType if you are the owner
        if (id === org.owner_id && id === user!.id) {
            return errorResponse(
                "Organization owner cannot change their own userType",
                403,
            );
        }

        // Get target user's information
        const { data: targetUser, error: targetUserError } = await adminClient
            .from("users")
            .select("user_type, organization_id")
            .eq("id", id)
            .single();

        if (targetUserError || !targetUser) {
            return errorResponse("Target user not found", 404);
        }

        // Check same organization
        if (requestingUser.organization_id !== targetUser.organization_id) {
            return errorResponse(
                "You can only change userType for users in your organization",
                403,
            );
        }

        // Role-based permissions (similar to deleteUser)
        const requestorRole = requestingUser.user_type;

        // MEMBER can't change anyone's userType
        if (requestorRole === "MEMBER") {
            return errorResponse("Members cannot change user types", 403);
        }

        // OWNER can't change ADMIN userType (same permission as deleteUser)
        if (requestorRole === "OWNER" && targetUser.user_type === "ADMIN") {
            return errorResponse("Owners cannot change Admin user types", 403);
        }

        // Update user type
        const { error: updateError } = await adminClient
            .from("users")
            .update({ user_type: userType })
            .eq("id", id);

        if (updateError) {
            console.error("User type update error:", updateError);
            return errorResponse("Failed to update user type", 500);
        }

        // Create response
        const response = {
            status: "success" as const,
            message: "User type updated successfully",
            user: {
                id: id,
                userType: userType,
            },
        };

        return successResponse(response, 200);
    } catch (error) {
        console.error("Change user type error:", error);
        return errorResponse(
            "An error occurred while changing user type",
            500,
        );
    }
});
