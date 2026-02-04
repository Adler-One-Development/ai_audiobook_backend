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
    const creditCost = characterCount / 1000;
    
    console.log(`Chapter Validation - Chars: ${characterCount}, Cost: ${creditCost} credits`);

    // 3. Check User's Organization Credits
    // Get organization_id from users table
    const { data: userData, error: userError } = await adminClient
        .from("users")
        .select("organization_id")
        .eq("id", user.id)
        .single();

    if (userError || !userData?.organization_id) {
        return errorResponse("User does not belong to an organization", 400);
    }

    // Get owner_id from organizations
    const { data: orgData, error: orgError } = await adminClient
        .from("organizations")
        .select("owner_id")
        .eq("id", userData.organization_id)
        .single();

    if (orgError || !orgData) {
        return errorResponse("Organization not found", 404);
    }
    const ownerId = orgData.owner_id;

    // Get available credits
    const { data: creditsData, error: creditsError } = await adminClient
        .from("credits_allocation")
        .select("credits_available")
        .eq("user_id", ownerId)
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
      
      // Download audio to temp file
      const tempFilePath = await Deno.makeTempFile({ suffix: ".mp3" });
      console.log(`Downloading audio stream to temp file: ${tempFilePath}`);
      
      const file = await Deno.open(tempFilePath, { write: true, create: true });
      await streamResponse.body?.pipeTo(file.writable);
      
      // Upload to Supabase Storage
      const fileContent = await Deno.readFile(tempFilePath);
      const fileName = `${crypto.randomUUID()}.mp3`;
      
      const { data: uploadData, error: uploadError } = await adminClient.storage
          .from("files")
          .upload(fileName, fileContent, {
              contentType: "audio/mpeg",
              upsert: false
          });
      
      if (uploadError) {
          console.error("Failed to upload file to storage:", uploadError);
          return errorResponse("Failed to upload audio file", 500);
      }

      // Get Public URL
      const { data: publicUrlData } = adminClient.storage
          .from("files")
          .getPublicUrl(fileName);
          
      const fileUrl = publicUrlData.publicUrl;
      const fileId = crypto.randomUUID();

      // Update Gallery if ID exists
      if (galleryId) {
          console.log(`Updating gallery ${galleryId}...`);
          
          const { data: gallery, error: galleryError } = await adminClient
              .from("galleries")
              .select("files")
              .eq("id", galleryId)
              .single();
              
          if (!galleryError && gallery) {
              const currentFiles = gallery.files || [];
              const newFile = {
                  id: fileId,
                  url: fileUrl
              };
              
              await adminClient
                  .from("galleries")
                  .update({ files: [...currentFiles, newFile] })
                  .eq("id", galleryId);
          } else {
              console.warn("Could not find gallery to update");
          }
      } else {
          console.warn("No gallery_id found for project. Skipping gallery update.");
      }

      // --- DEDUCT CREDITS ---
      console.log(`Deducting ${creditCost} credits from owner ${ownerId}...`);
      const { error: deductionError } = await adminClient.from("credits_allocation")
        .update({ credits_available: creditsData.credits_available - creditCost })
        .eq("user_id", ownerId);
      
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
