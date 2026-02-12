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
            cast_id,
            nickname,
            voice_id,
            override_globally,
            override_settings,
        } = await req.json();

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

        // 1. Fetch Studio
        const { data: studio, error: studioError } = await adminClient
            .from("studio")
            .select("cast")
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

        // 2. Find and Update Cast Member
        let castMemberFound = false;
        let targetVoiceId = "";

        const updatedCast = Array.isArray(studio.cast)
            ? studio.cast.map((member: any) => {
                if (member.id === cast_id) {
                    castMemberFound = true;
                    targetVoiceId = voice_id || member.voice_id; // Use new voice_id if provided, else keep existing

                    return {
                        ...member,
                        nickname: nickname || member.nickname,
                        voice_id: targetVoiceId,
                        override_globally: override_globally ??
                            member.override_globally,
                        override_settings: override_globally
                            ? (override_settings || member.override_settings)
                            : null,
                    };
                }
                return member;
            })
            : [];

        if (!castMemberFound) {
            return new Response(
                JSON.stringify({
                    status: "error",
                    message: "Cast member not found",
                }),
                { status: 404, headers: corsHeaders },
            );
        }

        // Note: Voice settings are applied when the voice is created in addCastMember.
        // We don't update ElevenLabs voice settings here to avoid modifying the isolated voice.

        const { error: updateError } = await adminClient
            .from("studio")
            .update({ cast: updatedCast })
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
                message: "Cast member updated",
            }),
            { status: 200, headers: corsHeaders },
        );
    } catch (error) {
        console.error("Error in editCastMember:", error);
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
