import { type CopyrightsGetResponse } from "../_shared/types.ts";
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
        // Parse request body
        const { organization_id } = await req.json();

        if (!organization_id) {
            return errorResponse("Organization ID is required", 400);
        }

        // Authenticate user
        const { error: authError } = await getAuthenticatedUser(req);
        if (authError) return authError;

        const adminClient = createAdminClient();

        // Fetch copyright text
        const { data: copyrightData, error: copyrightError } = await adminClient
            .from("copyrights")
            .select("copyrights_text, updated_at")
            .eq("organization_id", organization_id)
            .single();

        if (copyrightError && copyrightError.code !== "PGRST116") { // PGRST116 is no rows returned
             console.error("Error fetching copyright:", copyrightError);
             return errorResponse("Failed to fetch copyrights", 500);
        }

        return successResponse<CopyrightsGetResponse>({
            status: "success",
            message: "Copyrights fetched successfully",
            data: copyrightData || null, // Return null if not found
        }, 200);

    } catch (error) {
        console.error("Get organization copyright error:", error);
        return errorResponse(
            "An error occurred while fetching organization copyright",
            500,
        );
    }
});
