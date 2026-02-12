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
    // Get the authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: corsHeaders },
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseClient = createClient(supabaseUrl, supabaseKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    // Get the authenticated user
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
    const { studio_id, chapter_id } = await req.json();

    if (!studio_id || !chapter_id) {
      return new Response(
        JSON.stringify({
          status: "error",
          message: "Missing required fields: studio_id, chapter_id",
        }),
        { status: 400, headers: corsHeaders },
      );
    }

    // Create admin client for database operations
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch studio to get ElevenLabs API Key (if stored) or use env
    // In this project, it seems we pass keys or use env.
    // For backend APIs like this, we should use the env var ELEVEN_LABS_KEY
    const elevenLabsApiKey = Deno.env.get("ELEVEN_LABS_KEY");

    if (!elevenLabsApiKey) {
      return new Response(
        JSON.stringify({
          status: "error",
          message: "Server configuration error: Missing ElevenLabs API Key",
        }),
        { status: 500, headers: corsHeaders },
      );
    }

    // 1. Delete from ElevenLabs
    const elevenLabsUrl =
      `https://api.elevenlabs.io/v1/projects/${studio_id}/chapters/${chapter_id}`;
    const elResponse = await fetch(elevenLabsUrl, {
      method: "DELETE",
      headers: {
        "xi-api-key": elevenLabsApiKey,
      },
    });

    if (!elResponse.ok) {
      const errorText = await elResponse.text();
      console.error("ElevenLabs Delete Error:", errorText);
      // We might continue to delete from Supabase if it's already gone from EL,
      // but for now let's report error unless it's 404
      if (elResponse.status !== 404) {
        return new Response(
          JSON.stringify({
            status: "error",
            message: `Failed to delete from ElevenLabs: ${errorText}`,
          }),
          { status: 502, headers: corsHeaders },
        );
      }
    }

    // 2. Delete from Supabase Studio Table
    // Fetch current studio data
    const { data: studio, error: studioError } = await adminClient
      .from("studio")
      .select("chapters")
      .eq("id", studio_id)
      .single();

    if (studioError) {
      return new Response(
        JSON.stringify({
          status: "error",
          message: "Studio not found",
        }),
        { status: 404, headers: corsHeaders },
      );
    }

    if (studio && Array.isArray(studio.chapters)) {
      const updatedChapters = studio.chapters.filter((ch: any) =>
        ch.id !== chapter_id
      );

      const { error: updateError } = await adminClient
        .from("studio")
        .update({ chapters: updatedChapters })
        .eq("id", studio_id);

      if (updateError) {
        console.error("Supabase Update Error:", updateError);
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
        message: "Chapter deleted successfully",
      }),
      { status: 200, headers: corsHeaders },
    );
  } catch (error) {
    console.error("Error in deleteChapter:", error);
    return new Response(
      JSON.stringify({
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: corsHeaders },
    );
  }
});
