import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  errorResponse,
  handleCorsPreFlight,
  successResponse,
  corsHeaders
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";
import { AudioStorage } from "../_shared/audio-storage.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight();
  }

  try {
    console.log("Request Headers:", JSON.stringify(Object.fromEntries(req.headers.entries())));
    const authHeader = req.headers.get("Authorization");
    console.log("Auth Header present:", !!authHeader);
    if (authHeader) console.log("Auth Header start:", authHeader.substring(0, 20) + "...");

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

    // 1. Get project and verify access + get studio_id and gallery_id
    const { data: project, error: projectError } = await adminClient
      .from("projects")
      .select("studio_id, gallery_id")
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
    const galleryId = project.gallery_id;

    // --- CREDIT VALIDATION START ---
    // 2. Fetch studio data to calculate cost
    const { data: studio, error: studioError } = await adminClient
      .from("studio")
      .select("chapters")
      .eq("id", studioId)
      .single();

    if (studioError || !studio) {
        console.error("Error fetching studio:", studioError);
        return errorResponse("Failed to fetch studio details", 500);
    }

    // Find the chapter
    const chapter = (studio.chapters || []).find((c: any) => c.id === chapterId);
    if (!chapter) {
        return errorResponse("Chapter not found in studio", 404);
    }

    // Calculate characters
    let totalText = "";
    if (chapter.content_json && Array.isArray(chapter.content_json.blocks)) {
         chapter.content_json.blocks.forEach((block: any) => {
            if (Array.isArray(block.nodes)) {
                block.nodes.forEach((node: any) => {
                    if (node.text) {
                        totalText += node.text; 
                    }
                });
            }
         });
    }
    const characterCount = totalText.length;
    const creditCost = Math.ceil(characterCount / 1000);
    
    console.log(`Chapter Validation - Chars: ${characterCount}, Cost: ${creditCost} credits (Rounded Up)`);

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
    // --- CREDIT VALIDATION END ---

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
      
      // Convert response to Blob
      const audioBlob = await streamResponse.blob();
      if (!audioBlob || audioBlob.size === 0) {
          throw new Error("Empty audio response from ElevenLabs");
      }
      
      const audioStorage = new AudioStorage(adminClient);
      const { fileId, url: fileUrl } = await audioStorage.uploadChapterAudio(
          project.studio_id!, 
          chapterId as string,
          audioBlob
      );

      // --- DEDUCT CREDITS ---
      const { error: deductionError } = await adminClient.from("credits_allocation")
        .update({ 
            credits_available: creditsData.credits_available - creditCost,
            credits_used: (creditsData.credits_used || 0) + creditCost,
            total_credits_used: (creditsData.total_credits_used || 0) + creditCost
        })
        .eq("user_id", user.id);
      
      if (deductionError) {
          console.error("CRITICAL: Failed to deduct credits after generation!", deductionError);
          // We still return success as the user got their file, but we log this critical error.
      } else {
          console.log("Credits deducted successfully.");
      }
      // --- END DEDUCTION ---

      return successResponse({
          status: "success",
          message: "Audio generated successfully",
          project_id: projectId,
          chapter_id: chapterId,
          credits_used: creditCost,
          file: {
              id: fileId,
              url: fileUrl
          }
      });


  } catch (error) {
    console.error("Unexpected error:", error);
    return errorResponse("An unexpected error occurred", 500);
  }
});
