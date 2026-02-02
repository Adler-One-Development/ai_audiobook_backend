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

        // Parse pagination params
        const url = new URL(req.url);
        const page = parseInt(url.searchParams.get("page") || "1");
        const limit = parseInt(url.searchParams.get("limit") || "10");
        const from = (page - 1) * limit;
        const to = from + limit - 1;

        const { data: projects, count, error: projectsError } =
            await adminClient
                .from("projects")
                .select("*, gallery:galleries(*), genre:genres(*)", {
                    count: "exact",
                })
                .or(`owner_id.eq.${user.id},access_levels.cs.{${user.id}}`)
                .range(from, to)
                .order("created_at", { ascending: false });

        if (projectsError) {
            console.error("Error fetching projects:", projectsError);
            return errorResponse(
                `Failed to fetch projects: ${JSON.stringify(projectsError)}`,
                500,
            );
        }

        const total = count || 0;
        const totalPages = Math.ceil(total / limit);

        return successResponse({
            status: "success",
            message: "Projects retrieved successfully",
            data: projects,
            meta: {
                total,
                page,
                limit,
                totalPages,
            },
        }, 200);
    } catch (error) {
        console.error("Unexpected error:", error);
        return errorResponse("An unexpected error occurred", 500);
    }
});
