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
    // Enforce JSON Content-Type
    const contentType = req.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      return new Response(
        JSON.stringify({
          status: "error",
          message: "Invalid Content-Type. Please use 'application/json'.",
        }),
        { status: 415, headers: corsHeaders },
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: corsHeaders },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseClient = createClient(supabaseUrl, supabaseKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: corsHeaders },
      );
    }

    // Parse request body
    // Also accept camelCase aliases for user convenience
    const body = await req.json();
    const studio_id = body.studio_id || body.projectId;
    const chapter_id = body.chapter_id || body.chapterId;
    const chapter_name = body.chapter_name || body.chapterName || body.newName;

    if (!studio_id || !chapter_id || !chapter_name) {
      return new Response(
        JSON.stringify({
          status: "error",
          message:
            "Missing required fields: studio_id (or projectId), chapter_id (or chapterId), chapter_name (or newName)",
        }),
        { status: 400, headers: corsHeaders },
      );
    }

    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const elevenLabsKey = Deno.env.get("ELEVEN_LABS_KEY")!;

    // 1. Rename in ElevenLabs
    let elevenLabsSuccess = false;
    try {
      const elevenLabsResponse = await fetch(
        `https://api.elevenlabs.io/v1/studio/projects/${studio_id}/chapters/${chapter_id}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": elevenLabsKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: chapter_name,
          }),
        },
      );

      if (elevenLabsResponse.ok) {
        elevenLabsSuccess = true;
      } else {
        const errorData = await elevenLabsResponse.text();
        console.error("ElevenLabs rename failed:", errorData);
      }
    } catch (error) {
      console.error("ElevenLabs API error:", error);
    }

    // 2. Rename in Supabase Studio Table
    const { data: studio, error: studioError } = await adminClient
      .from("studio")
      .select("chapters")
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

    let chapterFound = false;
    if (Array.isArray(studio.chapters)) {
      const updatedChapters = studio.chapters.map((ch: any) => {
        if (ch.id === chapter_id) {
          chapterFound = true;
          return { ...ch, name: chapter_name };
        }
        return ch;
      });

      if (!chapterFound) {
        return new Response(
          JSON.stringify({
            status: "error",
            message: "Chapter not found in studio",
          }),
          { status: 404, headers: corsHeaders },
        );
      }

      const { error: updateError } = await adminClient
        .from("studio")
        .update({ chapters: updatedChapters })
        .eq("id", studio_id);

      if (updateError) {
        return new Response(
          JSON.stringify({
            status: "error",
            message: "Failed to update studio in database",
          }),
          { status: 500, headers: corsHeaders },
        );
      }
    }

    return new Response(
      JSON.stringify({
        status: "success",
        message: elevenLabsSuccess
          ? "Chapter renamed successfully in both Supabase and ElevenLabs"
          : "Chapter renamed in Supabase (ElevenLabs update failed)",
        elevenlabs_updated: elevenLabsSuccess,
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (error) {
    console.error("Error in renameChapter:", error);
    return new Response(
      JSON.stringify({
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: corsHeaders },
    );
  }
});
