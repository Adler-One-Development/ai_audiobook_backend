import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers":
                    "authorization, x-client-info, apikey, content-type",
            },
        });
    }

    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
            "authorization, x-client-info, apikey, content-type",
        "Content-Type": "application/json",
    };

    try {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: "Missing authorization header" }),
                { status: 401, headers: corsHeaders },
            );
        }

        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
        const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: authHeader } },
        });

        const { data: { user }, error: userError } = await supabaseClient.auth
            .getUser();
        if (userError || !user) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: corsHeaders,
            });
        }

        const {
            studio_id,
            nickname,
            voice_id,
            override_globally,
            override_settings,
        } = await req.json();

        if (!studio_id || !nickname || !voice_id) {
            return new Response(
                JSON.stringify({
                    status: "error",
                    message: "Missing required fields",
                }),
                { status: 400, headers: corsHeaders },
            );
        }

        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const adminClient = createClient(supabaseUrl, supabaseServiceKey);
        const elevenLabsApiKey = Deno.env.get("ELEVEN_LABS_KEY");

        if (!elevenLabsApiKey) {
            return new Response(
                JSON.stringify({
                    status: "error",
                    message: "Missing ElevenLabs API Key",
                }),
                { status: 500, headers: corsHeaders },
            );
        }

        // Logic 1: Clone Voice using Audio Samples
        let targetVoiceId = voice_id;

        if (override_globally && override_settings) {
            // 1. Get original voice details and samples
            const voiceResponse = await fetch(
                `https://api.elevenlabs.io/v1/voices/${voice_id}`,
                { headers: { "xi-api-key": elevenLabsApiKey } },
            );

            if (!voiceResponse.ok) {
                return new Response(
                    JSON.stringify({
                        status: "error",
                        message:
                            "Failed to fetch voice details from ElevenLabs",
                    }),
                    { status: 500, headers: corsHeaders },
                );
            }

            const voiceDetails = await voiceResponse.json();
            const samples = voiceDetails.samples || [];

            if (samples.length === 0) {
                return new Response(
                    JSON.stringify({
                        status: "error",
                        message:
                            "Voice has no samples to clone. Cannot create remix.",
                    }),
                    { status: 400, headers: corsHeaders },
                );
            }

            // 2. Download all voice samples
            const sampleFiles: { name: string; data: Blob }[] = [];
            for (const sample of samples) {
                const sampleResponse = await fetch(
                    `https://api.elevenlabs.io/v1/voices/${voice_id}/samples/${sample.sample_id}/audio`,
                    { headers: { "xi-api-key": elevenLabsApiKey } },
                );

                if (sampleResponse.ok) {
                    sampleFiles.push({
                        name: sample.file_name ||
                            `sample_${sample.sample_id}.mp3`,
                        data: await sampleResponse.blob(),
                    });
                }
            }

            if (sampleFiles.length === 0) {
                return new Response(
                    JSON.stringify({
                        status: "error",
                        message: "Failed to download voice samples",
                    }),
                    { status: 500, headers: corsHeaders },
                );
            }

            // 3. Create new voice clone
            const formData = new FormData();
            formData.append("name", `${nickname} (Cast Member)`);
            formData.append(
                "description",
                `Cloned from ${voiceDetails.name} for cast member ${nickname}`,
            );

            sampleFiles.forEach((file) => {
                formData.append("files", file.data, file.name);
            });

            const cloneResponse = await fetch(
                "https://api.elevenlabs.io/v1/voices/add",
                {
                    method: "POST",
                    headers: { "xi-api-key": elevenLabsApiKey },
                    body: formData,
                },
            );

            if (!cloneResponse.ok) {
                console.error(
                    "Voice clone failed:",
                    await cloneResponse.text(),
                );
                return new Response(
                    JSON.stringify({
                        status: "error",
                        message: "Failed to clone voice",
                    }),
                    { status: 500, headers: corsHeaders },
                );
            }

            const cloneResult = await cloneResponse.json();
            targetVoiceId = cloneResult.voice_id;

            // 4. Apply custom settings to the cloned voice
            const elSettings = {
                stability: override_settings.expressiveness ?? 0.5,
                similarity_boost: override_settings["voice fidelity"] ?? 0.75,
                style: override_settings.performance_intensity ?? 0,
                use_speaker_boost:
                    override_settings["enhance voice character"] ?? true,
            };

            await fetch(
                `https://api.elevenlabs.io/v1/voices/${targetVoiceId}/settings/edit`,
                {
                    method: "POST",
                    headers: {
                        "xi-api-key": elevenLabsApiKey,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(elSettings),
                },
            );
        }

        // Logic 2: Add to Studio Cast
        const { data: studio, error: studioError } = await adminClient
            .from("studio")
            .select("cast, chapters") // Fetch chapters too for replacement logic
            .eq("id", studio_id)
            .single();

        if (studioError || !studio) {
            return new Response(
                JSON.stringify({
                    status: "error",
                    message: "Studio not found",
                }),
                { status: 404, headers: corsHeaders },
            );
        }

        const castId = crypto.randomUUID();
        const newCastMember = {
            id: castId,
            nickname,
            original_voice_id: voice_id, // Keep track of what it was
            voice_id: targetVoiceId, // In this implementation, it's the same, but structure allows diff
            override_globally,
            override_settings: override_globally ? override_settings : null,
        };

        let updatedCast = Array.isArray(studio.cast)
            ? [...studio.cast, newCastMember]
            : [newCastMember];

        // Logic 3: Replace in Chapters if override_globally is true
        let updatedChapters = studio.chapters;
        let chaptersModified = false;

        if (
            override_globally && targetVoiceId !== voice_id &&
            Array.isArray(updatedChapters)
        ) {
            // Replace old voice_id with new targetVoiceId in all chapter blocks
            for (let i = 0; i < updatedChapters.length; i++) {
                const chapter = updatedChapters[i];
                if (
                    chapter.content_json &&
                    Array.isArray(chapter.content_json.blocks)
                ) {
                    let chapterChanged = false;
                    const newBlocks = chapter.content_json.blocks.map(
                        (block: any) => {
                            if (block.voice_id === voice_id) {
                                chapterChanged = true;
                                return { ...block, voice_id: targetVoiceId };
                            }
                            return block;
                        },
                    );

                    if (chapterChanged) {
                        // Update the chapter in memory
                        updatedChapters[i] = {
                            ...chapter,
                            content_json: {
                                ...chapter.content_json,
                                blocks: newBlocks,
                            },
                        };

                        // Update chapter in ElevenLabs Studio
                        await fetch(
                            `https://api.elevenlabs.io/v1/studio/projects/${studio_id}/chapters/${chapter.id}`,
                            {
                                method: "POST",
                                headers: {
                                    "xi-api-key": elevenLabsApiKey,
                                    "Content-Type": "application/json",
                                },
                                body: JSON.stringify({
                                    content: updatedChapters[i].content_json,
                                }),
                            },
                        );
                    }
                }
            }
        }

        const { error: updateError } = await adminClient
            .from("studio")
            .update({
                cast: updatedCast,
                chapters: updatedChapters,
            })
            .eq("id", studio_id);

        if (updateError) {
            return new Response(
                JSON.stringify({
                    status: "error",
                    message: "Failed to update studio",
                }),
                { status: 500, headers: corsHeaders },
            );
        }

        return new Response(
            JSON.stringify({ status: "success", cast_member: newCastMember }),
            { status: 200, headers: corsHeaders },
        );
    } catch (error) {
        console.error("Error in addCastMember:", error);
        return new Response(
            JSON.stringify({
                status: "error",
                message: error instanceof Error
                    ? error.message
                    : "Unknown error",
            }),
            { status: 500, headers: corsHeaders },
        );
    }
});
