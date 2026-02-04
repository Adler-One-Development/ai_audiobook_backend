import { createClient } from "jsr:@supabase/supabase-js@2";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";

/**
 * getGallery Edge Function
 *
 * Returns the full gallery object for a given project_id or studio_id.
 * Logic:
 * 1. Accept `id` query parameter
 * 2. Check `projects` table for `gallery_id` where `id = <provided_id>`
 * 3. If not found, check `studio` table for `gallery_id`
 * 4. Fetch full gallery object from `galleries` table
 * 5. Return gallery object
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

        // Verify user authentication
        const { data: { user }, error: authError } = await supabase.auth
            .getUser();

        if (authError || !user) {
            return errorResponse("Invalid token", 401);
        }

        // Parse query parameters
        const url = new URL(req.url);
        const id = url.searchParams.get("id");

        if (!id) {
            return errorResponse("Missing required parameter: id", 400);
        }

        let galleryId: string | null = null;

        // 1. Try to find gallery_id in projects table
        const { data: projectData, error: projectError } = await supabase
            .from("projects")
            .select("gallery_id")
            .eq("id", id)
            .maybeSingle();

        if (!projectError && projectData && projectData.gallery_id) {
            galleryId = projectData.gallery_id;
        }

        // 2. If not found in projects, try studio table
        if (!galleryId) {
            const { data: studioData, error: studioError } = await supabase
                .from("studio")
                .select("gallery_id")
                .eq("id", id)
                .maybeSingle();

            if (!studioError && studioData && studioData.gallery_id) {
                galleryId = studioData.gallery_id;
            }
        }

        // 3. If gallery_id not found in either table
        if (!galleryId) {
            return errorResponse(
                "No gallery found for the provided id",
                404,
            );
        }

        // 4. Fetch full gallery object from galleries table
        const { data: galleryData, error: galleryError } = await supabase
            .from("galleries")
            .select("*")
            .eq("id", galleryId)
            .single();

        if (galleryError || !galleryData) {
            console.error("Error fetching gallery:", galleryError);
            return errorResponse("Gallery not found", 404);
        }

        return successResponse({
            status: "success",
            message: "Gallery retrieved successfully",
            gallery: galleryData,
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
