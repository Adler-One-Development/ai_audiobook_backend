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

        // Fetch the credits pricing (single row table)
        const { data: pricing, error: pricingError } = await adminClient
            .from("credits_pricing")
            .select("*")
            .single();

        if (pricingError) {
            console.error("Failed to fetch credits pricing:", pricingError);
            return errorResponse("Failed to fetch credits pricing", 500);
        }

        // Create response
        const response = {
            status: "success" as const,
            message: "Credits pricing fetched successfully",
            pricing: {
                id: pricing.id,
                pricePerCredit: pricing.price_per_credit,
                createdAt: pricing.created_at,
                updatedAt: pricing.updated_at,
            },
        };

        return successResponse(response, 200);
    } catch (error) {
        console.error("Get credits cost error:", error);
        return errorResponse(
            "An error occurred while fetching credits cost",
            500,
        );
    }
});
