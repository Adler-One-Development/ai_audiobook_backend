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

  // Only accept DELETE requests
  if (req.method !== "DELETE") {
    return errorResponse("Method not allowed. Use DELETE.", 405);
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

    if (!projectId || !chapterId) {
      return errorResponse("Missing parameter: projectId or chapterId", 400);
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

     // 2. Fetch studio data (chapters, comments)
     const { data: studio, error: studioError } = await adminClient
     .from("studio")
     .select("chapters, comments")
     .eq("id", project.studio_id)
     .single();

   if (studioError || !studio) {
       if (studioError?.code === "PGRST116") {
            return errorResponse("Studio not found", 404);
       }
     console.error("Error fetching studio:", studioError);
     return errorResponse("Failed to fetch studio", 500);
   }

   const chaptersData = studio.chapters || [];
   const commentsData = studio.comments || [];

   // Check if chapter exists
   const chapterIndex = chaptersData.findIndex((c: any) => c.id === chapterId);
   if (chapterIndex === -1) {
       return errorResponse("Chapter not found in database", 404);
   }

    // 3. Call ElevenLabs API to delete chapter
    const elevenLabsResponse = await fetch(
      `https://api.elevenlabs.io/v1/studio/projects/${project.studio_id}/chapters/${chapterId}`,
      {
        method: "DELETE",
        headers: {
          "xi-api-key": elevenLabsApiKey,
        },
      }
    );

    if (!elevenLabsResponse.ok) {
      const errorText = await elevenLabsResponse.text();
      console.error("ElevenLabs API Error:", errorText);
      return errorResponse(
        `ElevenLabs API Error: ${elevenLabsResponse.statusText}`,
        elevenLabsResponse.status
      );
    }

    // 4. Update Database
    
    // Get the chapter to be deleted
    const deletedChapter = chaptersData[chapterIndex];
    
    // Collect block IDs from the deleted chapter
    const blockIdsToDelete = new Set();
    if (deletedChapter.content_json && Array.isArray(deletedChapter.content_json.blocks)) {
         deletedChapter.content_json.blocks.forEach((block: any) => {
             if (block.block_id) {
                 blockIdsToDelete.add(block.block_id);
             }
         });
    }

    // Remove chapter
    chaptersData.splice(chapterIndex, 1);

    // Remove associated comments
    const updatedComments = commentsData.filter((comment: any) => !blockIdsToDelete.has(comment.block_id));

    const { error: updateError } = await adminClient
      .from("studio")
      .update({ 
          chapters: chaptersData,
          comments: updatedComments
       })
      .eq("id", project.studio_id);

    if (updateError) {
      console.error("Error updating studio:", updateError);
      return errorResponse("Failed to update studio data", 500);
    }

    return successResponse({
      status: "success",
      message: "Chapter deleted successfully",
    });

  } catch (error) {
    console.error("Unexpected error:", error);
    return errorResponse("An unexpected error occurred", 500);
  }
});
