import { createClient } from "jsr:@supabase/supabase-js@2";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";

/**
 * getAllVoices Edge Function
 *
 * Retrieves all available ElevenLabs voices from the database.
 * No authentication is required for this endpoint (public data).
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
        const supabase = createClient(supabaseUrl, supabaseAnonKey);

        // Fetch all voices
        const { data: voices, error } = await supabase
            .from("voices")
            .select("*")
            .order("name");

        if (error) {
            console.error("Error fetching voices:", error);
            throw error;
        }

        return successResponse({
            status: "success",
            message: "Voices retrieved successfully",
            voices: voices || [],
        });
    } catch (err) {
        console.error("Unexpected error:", err);
        const errorMessage = err instanceof Error
            ? err.message
            : "Unknown error";
        return errorResponse(
            "Failed to fetch voices",
            500,
            [errorMessage],
        );
    }
});
