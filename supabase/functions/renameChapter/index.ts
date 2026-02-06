import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  errorResponse,
  handleCorsPreFlight,
  successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";
import { Chapter } from "../_shared/types.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight();
  }

  try {
    const { user, error: authError } = await getAuthenticatedUser(req);
    if (authError || !user) return authError;

    // Parse form data
    let formData;
    try {
      formData = await req.formData();
    } catch (e) {
      return errorResponse("Invalid form data", 400);
    }

    const projectId = formData.get("projectId");
    const chapterId = formData.get("chapterId");
    const newName = formData.get("newName");
    const elevenLabsApiKey = req.headers.get("eleven-labs-api-key");

    if (!projectId || !chapterId || !newName) {
      return errorResponse("Missing parameter: projectId, chapterId, or newName", 400);
    }

    if (!elevenLabsApiKey) {
        return errorResponse("Missing header: eleven-labs-api-key", 400);
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

    // 2. Call ElevenLabs API
    const elevenLabsUrl = `https://api.elevenlabs.io/v1/studio/projects/${project.studio_id}/chapters/${chapterId}`;
    
    const elevenLabsResponse = await fetch(elevenLabsUrl, {
        method: "POST",
        headers: {
            "xi-api-key": elevenLabsApiKey,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            name: newName
        })
    });

    if (!elevenLabsResponse.ok) {
        const errorText = await elevenLabsResponse.text();
        console.error("ElevenLabs API Error:", errorText);
        return errorResponse(`ElevenLabs API failed: ${elevenLabsResponse.statusText}`, 502);
    }

    // 3. Fetch current studio chapters
    const { data: studio, error: studioError } = await adminClient
      .from("studio")
      .select("chapters")
      .eq("id", project.studio_id)
      .single();

     if (studioError || !studio) {
        console.error("Error fetching studio:", studioError);
        return errorResponse("Failed to fetch studio data", 500);
    }

    // 4. Update local chapters
    const chapters: Chapter[] = studio.chapters || [];
    const chapterIndex = chapters.findIndex((c: any) => c.id === chapterId);

    if (chapterIndex === -1) {
        return errorResponse("Chapter found in ElevenLabs but not in local database", 404);
    }

    chapters[chapterIndex].name = newName;

    // 5. Update studio table
    const { error: updateError } = await adminClient
        .from("studio")
        .update({ chapters: chapters })
        .eq("id", project.studio_id);

    if (updateError) {
        console.error("Error updating studio chapters:", updateError);
        return errorResponse("Failed to update chapter name in database", 500);
    }

    return successResponse({
      status: "success",
      message: "Chapter renamed successfully",
      data: {
          projectId: projectId,
          chapterId: chapterId,
          newName: newName
      }
    }, 200);

  } catch (error) {
    console.error("Unexpected error:", error);
    return errorResponse("An unexpected error occurred", 500);
  }
});
