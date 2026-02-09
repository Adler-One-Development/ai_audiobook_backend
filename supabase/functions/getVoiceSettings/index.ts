
import { handleCorsPreFlight, successResponse, errorResponse } from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";

Deno.serve(async (req) => {
    // Handle CORS preflight request
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        // Authenticate user
        const { user, error } = await getAuthenticatedUser(req);

        if (error) {
            return error;
        }

        if (!user) {
            return errorResponse("Unauthorized", 401);
        }

        // Validate request
        if (req.method !== "GET") {
            return errorResponse("Method not allowed", 405);
        }

        // Extract voice_id from URL parameters
        const url = new URL(req.url);
        const voice_id = url.searchParams.get("voice_id");

        if (!voice_id) {
            return errorResponse("Missing required parameter: voice_id", 400);
        }

        // Get ElevenLabs API Key
        const elevenLabsApiKey = req.headers.get("eleven-labs-api-key") || Deno.env.get("ELEVEN_LABS_API_KEY");

        if (!elevenLabsApiKey) {
            return errorResponse("Server configuration error: Missing ElevenLabs API Key", 500);
        }

        // Fetch voice settings from ElevenLabs
        console.log(`Fetching settings for voice: ${voice_id}`);
        const response = await fetch(`https://api.elevenlabs.io/v1/voices/${voice_id}/settings`, {
            method: "GET",
            headers: {
                "xi-api-key": elevenLabsApiKey,
                "Content-Type": "application/json"
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`ElevenLabs API error: ${response.status} - ${errorText}`);
            return errorResponse(`Failed to fetch voice settings: ${errorText}`, response.status);
        }

        const settings = await response.json();
        
        const mappedSettings = {
            speaking_rate: settings.speed, // Default 1.0, range 0.5-2.0
            performance_intensity: settings.style, // Range 0-1
            expressiveness: settings.stability, // Range 0-1
            voice_fidelity: settings.similarity_boost, // Range 0-1
            enhance_voice_character: settings.use_speaker_boost // boolean
        };

        return successResponse({
            status: "success",
            message: "Voice settings retrieved successfully",
            data: {
                voice_id: voice_id,
                settings: mappedSettings
            }
        });

    } catch (error) {
        console.error("Error in getVoiceSettings:", error);
        return errorResponse("Internal server error", 500);
    }
});
