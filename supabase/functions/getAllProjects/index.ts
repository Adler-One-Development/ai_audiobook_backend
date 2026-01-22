import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        const { user, error: authError } = await getAuthenticatedUser(req);
        if (authError || !user) return authError;

        const adminClient = createAdminClient();

        // Query projects where user is owner OR user's ID is in access_levels
        // Note: access_levels is UUID[], so we use the 'cs' (contains) operator.
        // But since we want OR condition across columns, it's slightly complex with simple Supabase filters.
        // It's easier to use .or() syntax.

        const { data: projects, error: projectsError } = await adminClient
            .from("projects")
            .select("*")
            .or(`owner_id.eq.${user.id},access_levels.cs.{${user.id}}`);

        if (projectsError) {
            console.error("Error fetching projects:", projectsError);
            return errorResponse("Failed to fetch projects", 500);
        }

        return successResponse({
            status: "success",
            message: "Projects retrieved successfully",
            projects,
        }, 200);
    } catch (error) {
        console.error("Unexpected error:", error);
        return errorResponse("An unexpected error occurred", 500);
    }
});
