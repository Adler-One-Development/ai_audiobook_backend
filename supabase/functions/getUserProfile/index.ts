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

        // Fetch user profile with industry and profile picture
        const adminClient = createAdminClient();
        const { data: userData, error: userError } = await adminClient
            .from("users")
            .select(`
        id,
        full_name,
        email,
        phone,
        publisher_name,
        user_type,
        role,
        industry_id,
        industries (
          id,
          industry_name
        ),
        profile_picture_id,
        profile_pictures (
          id,
          url
        )
      `)
            .eq("id", user!.id)
            .single();

        if (userError || !userData) {
            console.error("Get user profile error:", userError);
            return errorResponse("User profile not found", 404);
        }

        // Format response
        const profile = {
            full_name: userData.full_name,
            email: userData.email,
            phone: userData.phone,
            publisher_name: userData.publisher_name,
            role: userData.role,
            industry: userData.industries || null,
            profile_picture: userData.profile_pictures || null,
            auth_type: user!.app_metadata?.provider || "email",
        };

        return successResponse(
            {
                status: "success" as const,
                message: "Profile fetched successfully",
                profile,
            },
            200,
        );
    } catch (error) {
        console.error("Get user profile error:", error);
        return errorResponse("An error occurred while fetching profile", 500);
    }
});
