import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  errorResponse,
  handleCorsPreFlight,
  successResponse,
  corsHeaders
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

    // Get ElevenLabs API Key
    const elevenLabsApiKey = req.headers.get("eleven-labs-api-key");
    if (!elevenLabsApiKey) {
      return errorResponse("Missing header: eleven-labs-api-key", 400);
    }

    // Parse form data
    let formData;
    try {
      formData = await req.formData();
    } catch (e) {
      return errorResponse("Invalid form data", 400);
    }

    const projectId = formData.get("projectId");
    const chapterId = formData.get("chapterId");
    const chapterSnapshotId = formData.get("chapterSnapshotId");

    if (!projectId || !chapterId || !chapterSnapshotId) {
      return errorResponse("Missing parameter: projectId, chapterId, or chapterSnapshotId", 400);
    }

    const adminClient = createAdminClient();

    // 1. Get project and verify access + get studio_id
    const { data: project, error: projectError } = await adminClient
      .from("projects")
      .select("studio_id")
      .eq("id", projectId)
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
    
    const studioId = project.studio_id;

    console.log(`Streaming snapshot: ${chapterSnapshotId}`);

    const streamResponse = await fetch(
        `https://api.elevenlabs.io/v1/studio/projects/${studioId}/chapters/${chapterId}/snapshots/${chapterSnapshotId}/stream`,
        {
          method: "POST",
          headers: {
            "xi-api-key": elevenLabsApiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({"convert_to_mpeg": true}),
        }
      );
      
      if (!streamResponse.ok) {
          const errorText = await streamResponse.text();
          console.error("ElevenLabs Stream Error:", errorText);
          return errorResponse(
            `ElevenLabs Stream Error: ${streamResponse.statusText}`,
            streamResponse.status
          );
      }
      
      // Return the audio stream
      // We need to proxy the stream back to the client
      
      // Get the headers from the upstream response to pass along (Content-Type, etc)
      // Usually it's audio/mpeg
      const contentType = streamResponse.headers.get("Content-Type") || "audio/mpeg";
      
      return new Response(streamResponse.body, {
          status: 200,
          headers: {
              ...corsHeaders,
              "Content-Type": contentType,
              "Transfer-Encoding": "chunked",
          }
      });


  } catch (error) {
    console.error("Unexpected error:", error);
    return errorResponse("An unexpected error occurred", 500);
  }
});
