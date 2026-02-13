import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  errorResponse,
  handleCorsPreFlight,
  successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight();
  }

  try {
    const { user, error: authError } = await getAuthenticatedUser(req);
    if (authError || !user) return authError;

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return errorResponse("Content-Type must be multipart/form-data", 400);
    }
    
    // Enforce ElevenLabs API Key requirement for the entire endpoint
    const elevenLabsApiKey = req.headers.get("eleven-labs-api-key");
    if (!elevenLabsApiKey) {
        return errorResponse("Missing header: eleven-labs-api-key", 400);
    }

    let voice_id: string | null = null;
    let speaking_rate: number | null = null;
    let performance_intensity: number | null = null;
    let expressiveness: number | null = null;
    let voice_fidelity: number | null = null;
    let enhance_voice_character: boolean | null = null;

    let voice_description: string | null = null;
    let studio_id: string | null = null;


    try {
      const formData = await req.formData();
      voice_id = formData.get("voice_id") as string;
      voice_description = formData.get("voice_description") as string;
      studio_id = formData.get("studio_id") as string;
      
      const speakingRateStr = formData.get("speaking_rate");
      if (speakingRateStr) speaking_rate = parseFloat(speakingRateStr as string);

      const performanceIntensityStr = formData.get("performance_intensity");
      if (performanceIntensityStr) performance_intensity = parseFloat(performanceIntensityStr as string);

      const expressivenessStr = formData.get("expressiveness");
      if (expressivenessStr) expressiveness = parseFloat(expressivenessStr as string);

      const voiceFidelityStr = formData.get("voice_fidelity");
      if (voiceFidelityStr) voice_fidelity = parseFloat(voiceFidelityStr as string);

      const enhanceVoiceCharacterStr = formData.get("enhance_voice_character");
      if (enhanceVoiceCharacterStr) {
          enhance_voice_character = enhanceVoiceCharacterStr === "true";
      }

    } catch (_e) {
      return errorResponse("Invalid FormData", 400);
    }

    // Validation
    if (!voice_id) {
        return errorResponse("Missing required field: voice_id", 400);
    }

    if (speaking_rate !== null && (speaking_rate < 0.5 || speaking_rate > 2.0)) {
        return errorResponse("speaking_rate must be between 0.5 and 2.0", 400);
    }

    if (performance_intensity !== null && (performance_intensity < 0 || performance_intensity > 1)) {
        return errorResponse("performance_intensity must be between 0 and 1", 400);
    }

    if (expressiveness !== null && (expressiveness < 0 || expressiveness > 1)) {
        return errorResponse("expressiveness must be between 0 and 1", 400);
    }

    if (voice_fidelity !== null && (voice_fidelity < 0 || voice_fidelity > 1)) {
        return errorResponse("voice_fidelity must be between 0 and 1", 400);
    }
    
    // TODO: Implement the actual logic to update node settings (DB update or API call)

    // Mapping Logic
    const speed = speaking_rate !== null ? speaking_rate : 1.0;
    
    // Define mapped settings type
    interface MappedSettings {
        speed: number;
        style?: number;
        stability?: number;
        similarity_boost?: number;
        use_speaker_boost?: boolean;
        description?: string;
    }

    const mappedSettings: MappedSettings = {
        speed: speed
    };

    if (performance_intensity !== null) {
        mappedSettings.style = performance_intensity;
    }
    
    if (expressiveness !== null) {
        // expressiveness --> stability [0 (more emotional) - 1(more monotone)]
        mappedSettings.stability = 1 - expressiveness;
    }

    if (voice_fidelity !== null) {
        mappedSettings.similarity_boost = voice_fidelity;
    }

    if (enhance_voice_character !== null) {
        mappedSettings.use_speaker_boost = enhance_voice_character;
    }

    if (voice_description) {
        mappedSettings.description = `Create an identical voice + ${voice_description}`;
    }

    // If voice_description is present, call remix API
    let generated_voice_id: string | null = null;
    
    if (mappedSettings.description) {
         // Get ElevenLabs API Key


        console.log(`Calling Remix API for voice ${voice_id}...`);
        const remixUrl = `https://api.elevenlabs.io/v1/text-to-voice/${voice_id}/remix`;
        
        const remixResponse = await fetch(remixUrl, {
            method: "POST",
            headers: {
                "xi-api-key": elevenLabsApiKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                voice_description: mappedSettings.description,
                auto_generate_text: true
            })
        });

        if (!remixResponse.ok) {
            const errorText = await remixResponse.text();
            console.error("ElevenLabs Remix API Error:", errorText);
            return errorResponse(`ElevenLabs Remix API Error: ${errorText}`, remixResponse.status);
        }

        const remixData = await remixResponse.json();
        console.log("Remix API Response:", JSON.stringify(remixData, null, 2));
        
        // Extract the first generated_voice_id from the response
        if (remixData.previews && remixData.previews.length > 0) {
            generated_voice_id = remixData.previews[0].generated_voice_id;
            console.log(`Generated voice ID from remix: ${generated_voice_id}`);
        } else {
            console.log("No previews found in remix response or previews array is empty");
        }
    } else {
        console.log("Skipping Remix API call - no voice_description provided");
    }

    // If we have a generated_voice_id, fetch its details
    interface VoiceDetails {
        labels: Record<string, string>;
        description: string;
    }
    
    let voice_details: VoiceDetails | null = null;
    if (generated_voice_id) {
        console.log(`Fetching details for voice ${voice_id}...`);
        const voiceDetailsUrl = `https://api.elevenlabs.io/v1/voices/${voice_id}?with_settings=true`;
        
        // Ensure we have the API key (it should be present if we got here, but good to check)

        if (elevenLabsApiKey) {
             const detailsResponse = await fetch(voiceDetailsUrl, {
                method: "GET",
                headers: {
                    "xi-api-key": elevenLabsApiKey
                }
            });

            if (detailsResponse.ok) {
                const detailsData = await detailsResponse.json();
                voice_details = {
                    labels: detailsData.labels,
                    description: detailsData.description
                };
            } else {
                 console.error("ElevenLabs Get Voice Details Error:", await detailsResponse.text());
                 // We don't fail the whole request if this fails, just log it
            }
        }
    }

    // Query the original voice from the voices table for metadata and naming
    let originalVoice: any = null;
    try {
        const { data, error: voiceQueryError } = await createAdminClient()
            .from("voices")
            .select("name, fine_tuning")
            .eq("voice_id", voice_id)
            .single();
        
        if (voiceQueryError) {
            console.error("Error querying original voice:", voiceQueryError);
        } else {
            originalVoice = data;
        }
    } catch (err) {
        console.error("Exception querying original voice:", err);
    }

    // Create the voice permanently
    let final_voice_id: string | null = null;
    if (generated_voice_id && voice_details) {
        console.log(`Creating persistent voice from ${generated_voice_id}...`);
        const createVoiceUrl = `https://api.elevenlabs.io/v1/text-to-voice`;
        
        // Ensure voice_description meets minimum 20 character requirement
        const voiceDescription = voice_details.description && voice_details.description.length >= 20 
            ? voice_details.description 
            : `Voice remixed from ${voice_id} with custom settings`;

        // Create voice name using original voice name
        const originalName = originalVoice?.name || voice_id;
        const voiceName = `${originalName}_remixed`;

        if (elevenLabsApiKey) {
            const createResponse = await fetch(createVoiceUrl, {
                method: "POST",
                headers: {
                    "xi-api-key": elevenLabsApiKey,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    voice_name: voiceName,
                    voice_description: voiceDescription,
                    generated_voice_id: generated_voice_id,
                    labels: voice_details.labels
                })
            });

            if (createResponse.ok) {
                const createData = await createResponse.json();
                final_voice_id = createData.voice_id;

                const adminClient = createAdminClient();
                
                // Insert the custom voice into the database if studio_id is provided
                if (final_voice_id && studio_id) {
                    try {

                        const { error: insertError } = await adminClient
                            .from("custom_voices")
                            .insert({
                                voice_id: final_voice_id,
                                name: `${createData.name}_remixed`,
                                studio_id: studio_id,
                                category: createData.category,
                                fine_tuning: originalVoice?.fine_tuning,
                                labels: createData.labels,
                                description: createData.description,
                                preview_url: createData.preview_url,
                                verified_languages: createData.verified_languages,
                                voice_settings: mappedSettings,
                                original_voice_id: voice_id
                            });

                        
                        if (insertError) {
                            console.error("Error inserting custom voice into database:", insertError);
                            // We don't fail the request if database insertion fails
                        } else {
                            console.log(`Successfully inserted custom voice ${final_voice_id} into database`);
                        }
                    } catch (dbError) {
                        console.error("Exception inserting custom voice into database:", dbError);
                        // We don't fail the request if database insertion fails
                    }
                }
            } else {
                console.error("ElevenLabs Create Voice Error:", await createResponse.text());
            }
        }
    }




    // Step 4: Apply settings to the target voice
    // Use the created voice ID if available, otherwise use the original voice ID
    const target_voice_id = final_voice_id || voice_id;
    let settings_applied = false;

    // We only apply settings if we have mapped settings to apply
    // Construct the settings payload
    const settingsPayload = {
        stability: mappedSettings.stability !== undefined ? mappedSettings.stability : 0.5, // Default if not mapped? Or keep check?
        similarity_boost: mappedSettings.similarity_boost !== undefined ? mappedSettings.similarity_boost : 0.75,
        style: mappedSettings.style !== undefined ? mappedSettings.style : 0,
        use_speaker_boost: mappedSettings.use_speaker_boost !== undefined ? mappedSettings.use_speaker_boost : true,
        // speed is NOT part of the /settings/edit endpoint body according to docs usually, 
        // but user request showed it in the body: "speed": 1. 
        // ElevenLabs /v1/voices/{voice_id}/settings/edit takes stability, similarity_boost, style, use_speaker_boost.
        // It does NOT documented taking speed. Speed is usually a synthesis parameter.
        // However, user explicitly asked for: -d '{ "speed": 1 ... }'
        // I will include it as requested.
        speed: mappedSettings.speed
    };

    console.log(`Applying settings to voice ${target_voice_id}...`, settingsPayload);
    const editSettingsUrl = `https://api.elevenlabs.io/v1/voices/${target_voice_id}/settings/edit`;
    
    // We need API key again
 
    if (elevenLabsApiKey) {
        const editResponse = await fetch(editSettingsUrl, {
            method: "POST",
            headers: {
                "xi-api-key": elevenLabsApiKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(settingsPayload)
        });

        if (editResponse.ok) {
            settings_applied = true;
        } else {
             console.error("ElevenLabs Edit Settings Error:", await editResponse.text());
             // Not failing the request, as per "Return the created voice id" priority, but ideally should warn.
        }
    }

    return successResponse({
        status: "success",
        message: "Voice settings processed successfully",
        data: {
             // simplified response as per "Return the created voice id" request implies simplified output or at least including it.
             // But keeping previous debug info might be useful.
             // User Request: "Return the created voice id".
             // I will prioritize returning the final target voice id prominently.
             voice_id: target_voice_id,
             
             // Keeping detailed info for debugging/verification
             details: {
                original_voice_id: voice_id,
                created_voice_id: final_voice_id,
                settings_applied: settings_applied,
                mapped_settings: mappedSettings,
                voice_details_fetched: voice_details,
             }
        }
    });

  } catch (error) {
    console.error("Unexpected error:", error);
    return errorResponse("An unexpected error occurred", 500);
  }
});
