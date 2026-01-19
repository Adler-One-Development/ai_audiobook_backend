import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        // Authenticate requesting user
        const { user, error: authError } = await getAuthenticatedUser(req);
        if (authError) return authError;

        const adminClient = createAdminClient();

        // Get user's information
        const { data: userData, error: userError } = await adminClient
            .from("users")
            .select("organization_id")
            .eq("id", user!.id)
            .single();

        if (userError || !userData) {
            return errorResponse("Failed to get user information", 404);
        }

        // Get organization details
        const { data: org, error: orgError } = await adminClient
            .from("organizations")
            .select("owner_id")
            .eq("id", userData.organization_id)
            .single();

        if (orgError || !org) {
            return errorResponse("Organization not found", 404);
        }

        // Check if user is the organization owner
        const isOrgOwner = user!.id === org.owner_id;

        if (isOrgOwner) {
            // Organization owner: Deactivate the entire organization
            // This will prevent all members from logging in
            const { error: orgUpdateError } = await adminClient
                .from("organizations")
                .update({ is_active: false })
                .eq("id", userData.organization_id);

            if (orgUpdateError) {
                console.error(
                    "Organization deactivation error:",
                    orgUpdateError,
                );
                return errorResponse(
                    "Failed to deactivate organization",
                    500,
                );
            }

            // Also deactivate all users in the organization
            const { error: usersUpdateError } = await adminClient
                .from("users")
                .update({ is_active: false })
                .eq("organization_id", userData.organization_id);

            if (usersUpdateError) {
                console.error(
                    "Failed to deactivate organization users:",
                    usersUpdateError,
                );
                // Continue anyway - org is already deactivated
            }

            const response = {
                status: "success" as const,
                message:
                    "Organization and all members deactivated successfully. All users in this organization can no longer log in.",
            };

            return successResponse(response, 200);
        } else {
            // Non-owner: Deactivate only their own account
            const { error: updateError } = await adminClient
                .from("users")
                .update({ is_active: false })
                .eq("id", user!.id);

            if (updateError) {
                console.error("User deactivation error:", updateError);
                return errorResponse("Failed to deactivate account", 500);
            }

            const response = {
                status: "success" as const,
                message:
                    "Your account has been deactivated successfully. You can no longer log in.",
            };

            return successResponse(response, 200);
        }
    } catch (error) {
        console.error("Deactivate account error:", error);
        return errorResponse(
            "An error occurred while deactivating account",
            500,
        );
    }
});
