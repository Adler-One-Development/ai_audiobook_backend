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
        const supabase = createAdminClient();

        // Fetch genres from the database
        const { data, error } = await supabase
            .from("genres")
            .select("id, genre_name")
            .order("genre_name", { ascending: true });

        if (error) {
            console.error("Error fetching genres:", error);
            return errorResponse("Failed to fetch genres", 500);
        }

        // Map to API response format (camelCase)
        const genres = data.map((g: any) => ({
            id: g.id,
            genreName: g.genre_name,
        }));

        return successResponse({
            status: "success",
            message: "Genres retrieved successfully",
            genres,
        }, 200);
    } catch (error) {
        console.error("Unexpected error:", error);
        return errorResponse("An unexpected error occurred", 500);
    }
});
