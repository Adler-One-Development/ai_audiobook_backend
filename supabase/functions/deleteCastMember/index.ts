import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "DELETE, OPTIONS",
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

        const { studio_id, cast_id } = await req.json();

        if (!studio_id || !cast_id) {
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

        // 1. Fetch Studio with Cast and Chapters
        const { data: studio, error: studioError } = await adminClient
            .from("studio")
            .select("cast, chapters")
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

        // 2. Identify Cast Member to Remove
        const castMember = Array.isArray(studio.cast)
            ? studio.cast.find((m: any) => m.id === cast_id)
            : null;

        if (!castMember) {
            return new Response(
                JSON.stringify({
                    status: "error",
                    message: "Cast member not found",
                }),
                { status: 404, headers: corsHeaders },
            );
        }

        // 3. Logic: Revert IDs in Chapters
        // "replaces all voice_id ... with the og voice id"
        // This effectively undos the global override.
        const originalVoiceId = castMember.original_voice_id;
        const currentVoiceId = castMember.voice_id;

        // If IDs differ, we must revert. If they are the same (as per my current addCastMember limit),
        // there's no textual change needed, BUT we interpret "replaces ... with og voice id" as ensuring consistency.

        let updatedChapters = studio.chapters;
        let chaptersModified = false;

        if (
            originalVoiceId && currentVoiceId &&
            originalVoiceId !== currentVoiceId && Array.isArray(updatedChapters)
        ) {
            updatedChapters = updatedChapters.map((chapter: any) => {
                let chapterChanged = false;
                let newBlocks = [];

                if (
                    chapter.content_json &&
                    Array.isArray(chapter.content_json.blocks)
                ) {
                    newBlocks = chapter.content_json.blocks.map(
                        (block: any) => {
                            if (block.voice_id === currentVoiceId) {
                                chapterChanged = true;
                                return { ...block, voice_id: originalVoiceId };
                            }
                            return block;
                        },
                    );
                }

                if (chapterChanged) {
                    chaptersModified = true;
                    // Trigger ElevenLabs update for this chapter
                    if (elevenLabsApiKey) {
                        const updateChapterUrl =
                            `https://api.elevenlabs.io/v1/projects/${studio_id}/chapters/${chapter.id}`;
                        fetch(updateChapterUrl, { // Fire and forget or await? Let's await to ensuring consistency? Or fire and forget for speed.
                            method: "POST",
                            headers: {
                                "xi-api-key": elevenLabsApiKey,
                                "Content-Type": "application/json",
                            },
                            body: JSON.stringify({
                                content: { blocks: newBlocks },
                            }),
                        }).catch((e) =>
                            console.error(
                                `Failed to revert chapter ${chapter.id} in EL`,
                                e,
                            )
                        );
                    }
                    return { ...chapter, content_json: { blocks: newBlocks } };
                }
                return chapter;
            });
        }

        // 4. Remove from Cast List
        const updatedCast = studio.cast.filter((m: any) => m.id !== cast_id);

        // 5. Update Studio
        const updatePayload: any = { cast: updatedCast };
        if (chaptersModified) {
            updatePayload.chapters = updatedChapters;
        }

        const { error: updateError } = await adminClient
            .from("studio")
            .update(updatePayload)
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
            JSON.stringify({
                status: "success",
                message: "Cast member deleted and chapters reverted",
            }),
            { status: 200, headers: corsHeaders },
        );
    } catch (error) {
        console.error("Error in deleteCastMember:", error);
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
