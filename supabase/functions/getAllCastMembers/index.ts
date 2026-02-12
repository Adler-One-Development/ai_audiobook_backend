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

        // Parse query parameters
        const url = new URL(req.url);
        const studio_id = url.searchParams.get("studio_id");

        if (!studio_id) {
            return errorResponse("Missing required parameter: studio_id", 400);
        }

        // Fetch studio cast
        const { data: studio, error: studioError } = await adminClient
            .from("studio")
            .select("cast")
            .eq("id", studio_id)
            .single();

        if (studioError) {
            console.error("Error fetching studio:", studioError);
            return errorResponse(
                `Failed to fetch studio: ${JSON.stringify(studioError)}`,
                500,
            );
        }

        if (!studio) {
            return errorResponse("Studio not found", 404);
        }

        const cast = Array.isArray(studio.cast) ? studio.cast : [];

        return successResponse({
            status: "success",
            message: "Cast members retrieved successfully",
            data: cast,
        }, 200);
    } catch (error) {
        console.error("Unexpected error:", error);
        return errorResponse("An unexpected error occurred", 500);
    }
});
