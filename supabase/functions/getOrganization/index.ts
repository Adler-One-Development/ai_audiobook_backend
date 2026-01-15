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
        // Authenticate user
        const { user, error: authError } = await getAuthenticatedUser(req);
        if (authError) return authError;

        const adminClient = createAdminClient();

        // Get user's organization_id
        const { data: userData, error: userError } = await adminClient
            .from("users")
            .select("organization_id")
            .eq("id", user!.id)
            .single();

        if (userError || !userData) {
            return errorResponse("User not found", 404);
        }

        if (!userData.organization_id) {
            return errorResponse("User is not part of any organization", 404);
        }

        // Get organization details
        const { data: organization, error: orgError } = await adminClient
            .from("organizations")
            .select("id, owner_id, member_ids, created_at, updated_at")
            .eq("id", userData.organization_id)
            .single();

        if (orgError || !organization) {
            return errorResponse("Organization not found", 404);
        }

        // Create response
        const response = {
            status: "success" as const,
            message: "Organization fetched successfully",
            organization: {
                id: organization.id,
                ownerId: organization.owner_id,
                memberIds: organization.member_ids || [],
                createdAt: organization.created_at,
                updatedAt: organization.updated_at,
            },
        };

        return successResponse(response, 200);
    } catch (error) {
        console.error("Get organization error:", error);
        return errorResponse(
            "An error occurred while fetching organization",
            500,
        );
    }
});
