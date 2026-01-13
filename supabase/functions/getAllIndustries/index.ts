import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        // Fetch all industries
        const adminClient = createAdminClient();
        const { data: industries, error } = await adminClient
            .from("industries")
            .select("id, industry_name")
            .order("industry_name", { ascending: true });

        if (error) {
            console.error("Get industries error:", error);
            return errorResponse("Failed to fetch industries", 500);
        }

        // Return industries list
        return successResponse(
            {
                status: "success" as const,
                message: "Industries fetched successfully",
                industries: industries || [],
            },
            200,
        );
    } catch (error) {
        console.error("Get industries error:", error);
        return errorResponse(
            "An error occurred while fetching industries",
            500,
        );
    }
});
