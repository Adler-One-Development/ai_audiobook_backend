
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  errorResponse,
  handleCorsPreFlight,
  successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";
import { AudioStorage } from "../_shared/audio-storage.ts";

// Define minimal types for JSON content structure
interface ContentNode {
    text?: string;
    [key: string]: unknown;
}

interface ContentBlock {
    nodes?: ContentNode[];
    [key: string]: unknown;
}

interface Chapter {
    content_json?: {
        blocks?: ContentBlock[];
    };
    [key: string]: unknown;
}

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
    } catch (_e) {
      return errorResponse("Invalid form data", 400);
    }

    const projectId = formData.get("project_id") as string;
    const projectSnapshotId = formData.get("project_snapshot_id") as string;

    if (!projectId || !projectSnapshotId) {
      return errorResponse("Missing parameter: project_id or project_snapshot_id", 400);
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

    // Calculate characters across ALL chapters
    let totalProjectCharacters = 0;
    const chapters = (studio.chapters || []) as Chapter[];
    
    chapters.forEach((chapter) => {
        if (chapter.content_json && Array.isArray(chapter.content_json.blocks)) {
             chapter.content_json.blocks.forEach((block) => {
                if (Array.isArray(block.nodes)) {
                    block.nodes.forEach((node) => {
                        if (node.text) {
                            totalProjectCharacters += node.text.length; 
                        }
                    });
                }
             });
        }
    });

    const creditCost = Math.ceil(totalProjectCharacters / 1000);
    
    console.log(`Project Validation - Total Chars: ${totalProjectCharacters}, Cost: ${creditCost} credits (Rounded Up)`);

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

    console.log(`Streaming project snapshot: ${projectSnapshotId}`);

    const streamResponse = await fetch(
        `https://api.elevenlabs.io/v1/studio/projects/${studioId}/snapshots/${projectSnapshotId}/stream`,
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
      
      // Get Blob from response instead of creating temp file
      const audioBlob = await streamResponse.blob();
      
      const audioStorage = new AudioStorage(adminClient);
      const { fileId, url: fileUrl } = await audioStorage.uploadAudiobookAudio(studioId, audioBlob);

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
      } else {
          console.log("Credits deducted successfully.");
      }
      // --- END DEDUCTION ---

      return successResponse({
          status: "success",
          message: "Audio generated successfully",
          project_id: projectId,
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
