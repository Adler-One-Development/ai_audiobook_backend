import { createClient } from "jsr:@supabase/supabase-js@2";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";

/**
 * getTotalCredits Edge Function
 *
 * Returns the total available credits for the authenticated user's organization.
 * Logic:
 * 1. Identify logged-in user.
 * 2. Get organization_id from users table.
 * 3. Get owner_id from organizations table.
 * 4. Get credits_available from credits_allocation for owner_id.
 */
Deno.serve(async (req) => {
    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        // Initialize Supabase client
        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
        const authHeader = req.headers.get("Authorization");

        if (!authHeader) {
            return errorResponse("Missing Authorization header", 401);
        }

        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: authHeader } },
        });

        // 1. Identify logged-in user
        const { data: { user }, error: authError } = await supabase.auth
            .getUser();

        if (authError || !user) {
            return errorResponse("Invalid token", 401);
        }

        // 2. Get organization_id from users table
        const { data: userData, error: userError } = await supabase
            .from("users")
            .select("organization_id")
            .eq("id", user.id)
            .single();

        if (userError || !userData) {
            console.error("Error fetching user data:", userError);
            return errorResponse("User profile not found", 404);
        }

        if (!userData.organization_id) {
            // Fallback: If user has no organization, check their own credits directly
            // This handles cases where a user might be an 'independent' owner without an explicit org record yet
            // OR simply return 0 if strict org logic is required.
            // Based on prompt "credits are shared based on organization", we should strictly follow the org path.
            // However, if the user IS the owner and hasn't set up an org entry (unlikely in this schema),
            // they should have an org.
            return errorResponse(
                "User does not belong to an organization",
                400,
            );
        }

        // 3. Get owner_id from organizations table
        const { data: orgData, error: orgError } = await supabase
            .from("organizations")
            .select("owner_id")
            .eq("id", userData.organization_id)
            .single();

        if (orgError || !orgData) {
            console.error("Error fetching organization:", orgError);
            return errorResponse("Organization not found", 404);
        }

        const ownerId = orgData.owner_id;

        // 4. Get credits_available from credits_allocation for owner_id
        const { data: creditsData, error: creditsError } = await supabase
            .from("credits_allocation")
            .select("credits_available")
            .eq("user_id", ownerId)
            .maybeSingle(); // Use maybeSingle as credits might not exist yet

        if (creditsError) {
            console.error("Error fetching credits:", creditsError);
            return errorResponse("Failed to fetch credits", 500);
        }

        const totalCredits = creditsData ? creditsData.credits_available : 0;

        return successResponse({
            status: "success",
            message: "Total credits retrieved successfully",
            total_credits: totalCredits,
        });
    } catch (err) {
        console.error("Unexpected error:", err);
        const errorMessage = err instanceof Error
            ? err.message
            : "Unknown error";
        return errorResponse(
            "Internal server error",
            500,
            [errorMessage],
        );
    }
});
