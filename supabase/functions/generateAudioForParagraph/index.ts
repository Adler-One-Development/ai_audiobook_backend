
import { handleCorsPreFlight, errorResponse, corsHeaders } from "../_shared/response-helpers.ts";

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
        // Parse request body
        const rawBody = await req.text();
        console.log("Request Body:", rawBody);
        
        let body;
        try {
            body = JSON.parse(rawBody);
        } catch (e) {
            console.error("Invalid JSON:", e);
            return errorResponse("Invalid JSON body", 400);
        }
        
        const { nodes, block_id } = body;

        interface TTSNode {
            type: string;
            text: string;
            voice_id: string;
            [key: string]: unknown;
        }

        if (!nodes || !Array.isArray(nodes)) {
            return errorResponse("Invalid input: 'nodes' array is required", 400);
        }

        // Filter for valid tts_nodes
        const ttsNodes: TTSNode[] = nodes.filter((node: unknown) => {
            const n = node as TTSNode;
            return n.type === "tts_node" && n.text && n.voice_id;
        });

        if (ttsNodes.length === 0) {
            return errorResponse("No valid tts_nodes found in the block", 400);
        }

        console.log(`Processing ${ttsNodes.length} nodes for block ${block_id || 'unknown'}`);

        // Get ElevenLabs API Key
        const elevenLabsApiKey = req.headers.get("eleven-labs-api-key") || Deno.env.get("ELEVEN_LABS_API_KEY");
        if (!elevenLabsApiKey) {
            return errorResponse("Server configuration error: Missing ElevenLabs API Key", 500);
        }

        const tempFiles: string[] = [];

        try {
            // Step 1: Download all audio segments to temporary files
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

                if (!response.body) {
                    throw new Error(`Empty response body for node ${i}`);
                }

                const tempFilePath = await Deno.makeTempFile({ prefix: `audio_${i}_`, suffix: ".mp3" });
                tempFiles.push(tempFilePath);
                
                const file = await Deno.open(tempFilePath, { write: true, create: true });
                await response.body.pipeTo(file.writable);
            }

            // Step 2: Stitch audio files into memory buffer
            let totalSize = 0;
            const fileBuffers: Uint8Array[] = [];

            for (const filePath of tempFiles) {
                const fileInfo = await Deno.stat(filePath);
                totalSize += fileInfo.size;
                const fileData = await Deno.readFile(filePath);
                fileBuffers.push(fileData);
                // Clean up immediately
                await Deno.remove(filePath);
            }

            const stitchedBuffer = new Uint8Array(totalSize);
            let offset = 0;
            for (const buffer of fileBuffers) {
                stitchedBuffer.set(buffer, offset);
                offset += buffer.length;
            }

            return new Response(stitchedBuffer, {
                headers: {
                    "Content-Type": "audio/mpeg",
                    "Content-Length": totalSize.toString(),
                    ...corsHeaders
                }
            });

        } catch (error) {
            // Cleanup any created files on error
            for (const path of tempFiles) {
                try {
                    await Deno.remove(path);
                } catch (_e) {
                    // Ignore
                }
            }
            console.error("Error processing audio nodes:", error);
            return errorResponse(error instanceof Error ? error.message : "Internal server error", 500);
        }

    } catch (error) {
        console.error("Error in generateAudioForParagraph:", error);
        return errorResponse("Internal server error", 500);
    }
});

