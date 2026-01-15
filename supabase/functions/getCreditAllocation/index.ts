import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { createClientFromRequest } from "../_shared/supabase-client.ts";
import { getOrganization } from "../_shared/auth-helpers.ts"; // using getOrg to get user easily, or just getUser

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return handleCorsPreFlight();

    try {
        const supabaseClient = createClientFromRequest(req);

        // Get Requesting User
        const { data: { user }, error: userError } = await supabaseClient.auth
            .getUser();
        if (userError || !user) return errorResponse("Unauthorized", 401);

        const startTime = Date.now();

        // Fetch Credit Allocation
        const { data: allocation, error } = await supabaseClient
            .from("credits_allocation")
            .select("*")
            .eq("user_id", user.id)
            .single();

        if (error && error.code !== "PGRST116") { // PGRST116 is "Row not found"
            throw error;
        }

        // If no allocation record exists, return 0s
        const result = allocation || {
            user_id: user.id,
            credits_available: 0,
            credits_used: 0,
            total_credits_used: 0,
        };

        return successResponse({
            status: "success",
            message: "Credit allocation fetched successfully",
            allocation: result,
            processingTimeMs: Date.now() - startTime,
        }, 200);
    } catch (error: any) {
        console.error("getCreditAllocation error:", error);
        return errorResponse(error.message, 500);
    }
});
