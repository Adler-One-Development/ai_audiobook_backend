
import { handleCorsPreFlight, errorResponse, corsHeaders } from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";
import { AudioStorage } from "../_shared/audio-storage.ts";

Deno.serve(async (req) => {
    // Handle CORS preflight request
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        // Validate request method
        if (req.method !== "POST") {
            return errorResponse("Method not allowed", 405);
        }

        // Get authenticated user
        const { user, error: authError } = await getAuthenticatedUser(req);
        if (authError) {
            return authError; // authError is a Response object
        }
        if (!user) {
            return errorResponse("Authentication required", 401);
        }

        // Parse form data
        let formData;
        try {
            formData = await req.formData();
        } catch (e) {
            console.error("Invalid form data:", e);
            return errorResponse("Invalid form data", 400);
        }
        
        const project_id = formData.get("projectId") as string;
        const chapter_id = formData.get("chapterId") as string;
        const block_id = formData.get("blockId") as string;

        if (!project_id || !chapter_id || !block_id) {
            return errorResponse("Missing required fields: project_id, chapter_id, and block_id", 400);
        }

        console.log(`Processing block ${block_id} from chapter ${chapter_id} in project ${project_id}`);

        // Create admin client for database operations
        const adminClient = createAdminClient();

        // Step 1: Get project and verify access + retrieve studio_id
        const { data: project, error: projectError } = await adminClient
            .from("projects")
            .select("studio_id")
            .eq("id", project_id)
            .or(`owner_id.eq.${user.id},access_levels.cs.{${user.id}}`)
            .single();

        if (projectError || !project) {
            if (projectError?.code === "PGRST116") {
                return errorResponse("Project not found or access denied", 404);
            }
            console.error("Error fetching project:", projectError);
            return errorResponse("Failed to fetch project", 500);
        }

        if (!project.studio_id) {
            return errorResponse("Project does not have a studio associated", 404);
        }

        const studio_id = project.studio_id;

        // Step 2: Fetch studio data (chapters)
        const { data: studio, error: studioError } = await adminClient
            .from("studio")
            .select("chapters")
            .eq("id", studio_id)
            .single();

        if (studioError || !studio) {
            if (studioError?.code === "PGRST116") {
                return errorResponse("Studio not found", 404);
            }
            console.error("Error fetching studio:", studioError);
            return errorResponse("Failed to fetch studio", 500);
        }

        const chapters = studio.chapters || [];

        // Step 3: Find the specific chapter
        const chapter = chapters.find((ch: any) => ch.id === chapter_id);
        if (!chapter) {
            return errorResponse(`Chapter with ID ${chapter_id} not found`, 404);
        }

        // Step 4: Find the specific block within the chapter
        const blocks = chapter.content_json?.blocks || [];
        const block = blocks.find((b: any) => b.block_id === block_id);
        if (!block) {
            return errorResponse(`Block with ID ${block_id} not found in chapter`, 404);
        }

        // Step 5: Extract TTS nodes from the block
        interface TTSNode {
            type: string;
            text: string;
            voice_id: string;
            [key: string]: unknown;
        }

        const nodes = block.nodes || [];
        const ttsNodes: TTSNode[] = nodes.filter((node: any) => {
            return node.type === "tts_node" && node.text && node.voice_id;
        });

        if (ttsNodes.length === 0) {
            return errorResponse("No valid tts_nodes found in the block", 400);
        }

        console.log(`Processing ${ttsNodes.length} nodes for block ${block_id}`);

        // Calculate total character count for credit validation
        const characterCount = ttsNodes.reduce((sum, node) => sum + node.text.length, 0);
        const creditCost = Math.ceil(characterCount / 1000);
        
        console.log(`Block Validation - Chars: ${characterCount}, Cost: ${creditCost} credits (Rounded Up)`);

        // Get available credits
        const { data: creditsData, error: creditsError } = await adminClient
            .from("credits_allocation")
            .select("credits_available, credits_used, total_credits_used")
            .eq("user_id", user.id)
            .single();

        if (creditsError || !creditsData) {
            return errorResponse("Failed to fetch credit balance", 500);
        }

        if (creditsData.credits_available < creditCost) {
            return errorResponse(`Insufficient credits. Required: ${creditCost}, Available: ${creditsData.credits_available}`, 402);
        }

        // Get ElevenLabs API Key
        const elevenLabsApiKey = req.headers.get("eleven-labs-api-key") || Deno.env.get("ELEVEN_LABS_API_KEY");
        if (!elevenLabsApiKey) {
            return errorResponse("Server configuration error: Missing ElevenLabs API Key", 500);
        }

        const audioBlobs: Blob[] = [];

        try {
            // Step 1: Download all audio segments to memory blobs
            for (let i = 0; i < ttsNodes.length; i++) {
                const node = ttsNodes[i];
                console.log(`Generating audio for node ${i + 1}/${ttsNodes.length} (Voice: ${node.voice_id})`);

                const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${node.voice_id}?output_format=mp3_44100_128`, {
                    method: "POST",
                    headers: {
                        "xi-api-key": elevenLabsApiKey,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        text: node.text,
                        model_id: "eleven_multilingual_v2",
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`ElevenLabs API error for node ${i}: ${response.status} - ${errorText}`);
                    throw new Error(`Failed to generate audio for node ${i}: ${errorText}`);
                }

                const blob = await response.blob();
                if (!blob || blob.size === 0) {
                     throw new Error(`Empty response body for node ${i}`);
                }
                audioBlobs.push(blob);
            }

            // Step 2: Stitch audio files into memory buffer
            let totalSize = 0;
            const fileBuffers: Uint8Array[] = [];

            for (const blob of audioBlobs) {
                totalSize += blob.size;
                const buffer = new Uint8Array(await blob.arrayBuffer());
                fileBuffers.push(buffer);
            }

            const stitchedBuffer = new Uint8Array(totalSize);
            let offset = 0;
            for (const buffer of fileBuffers) {
                stitchedBuffer.set(buffer, offset);
                offset += buffer.length;
            }

            // Step 3: Upload to storage using AudioStorage helper
            const audioStorage = new AudioStorage(adminClient);
            const { fileId, url } = await audioStorage.uploadBlockAudio(studio_id, block_id, stitchedBuffer);

            console.log(`Audio uploaded successfully. File ID: ${fileId}, URL: ${url}`);

            // Step 4: Deduct credits
            const { error: deductionError } = await adminClient
                .from("credits_allocation")
                .update({
                    credits_available: creditsData.credits_available - creditCost,
                    credits_used: (creditsData.credits_used || 0) + creditCost,
                    total_credits_used: (creditsData.total_credits_used || 0) + creditCost
                })
                .eq("user_id", user.id);

            if (deductionError) {
                console.error("Failed to deduct credits:", deductionError);
                return errorResponse("Failed to update credit balance", 500);
            }

            console.log(`Deducted ${creditCost} credits from user ${user.id}`);

            // Return success response with file information
            return new Response(JSON.stringify({
                success: true,
                message: "Audio generated and uploaded successfully",
                data: {
                    file_id: fileId,
                    url: url,
                    block_id: block_id,
                    character_count: characterCount,
                    credits_used: creditCost
                }
            }), {
                headers: {
                    "Content-Type": "application/json",
                    ...corsHeaders
                }
            });

        } catch (error) {
            console.error("Error processing audio nodes:", error);
            return errorResponse(error instanceof Error ? error.message : "Internal server error", 500);
        }

    } catch (error) {
        console.error("Error in generateAudioForParagraph:", error);
        return errorResponse("Internal server error", 500);
    }
});

