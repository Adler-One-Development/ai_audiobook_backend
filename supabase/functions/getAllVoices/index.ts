
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        const { user, error: authError } = await getAuthenticatedUser(req);
        if (authError || !user) return authError;

        const xiApiKey = req.headers.get("xi-api-key");

        if (!xiApiKey) {
            return errorResponse("Missing xi-api-key header", 400); 
        }

        const elevenLabsResponse = await fetch(
            "https://api.elevenlabs.io/v2/voices?page_size=100",
            {
                method: "GET",
                headers: {
                    "xi-api-key": xiApiKey,
                },
            }
        );

        if (!elevenLabsResponse.ok) {
            const errorText = await elevenLabsResponse.text();
             console.error("ElevenLabs API Error:", elevenLabsResponse.status, errorText);
            return errorResponse(`ElevenLabs API Error: ${elevenLabsResponse.statusText}`, elevenLabsResponse.status);
        }

        const data = await elevenLabsResponse.json();

        const voices = data.voices.map((voice: Record<string, any>) => ({
            voice_id: voice.voice_id,
            name: voice.name,
            category: voice.category,
            labels: voice.labels,
            description: voice.description,
            preview_url: voice.preview_url,
        }));

        return successResponse({
            status: "success",
            message: "Voices retrieved successfully",
            voices
        }, 200);

    } catch (error) {
        console.error("Unexpected error:", error);
        return errorResponse("An unexpected error occurred", 500);
    }
});
