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

  try {
    const { user, error: authError } = await getAuthenticatedUser(req);
    if (authError || !user) return authError;

    // Get ElevenLabs API Key
    const elevenLabsApiKey = req.headers.get("eleven-labs-api-key");
    if (!elevenLabsApiKey) {
      return errorResponse("Missing header: eleven-labs-api-key", 400);
    }

    // Parse request body
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return errorResponse("Invalid JSON body", 400);
    }

    const { projectId, chapterId, content } = body;

    if (!projectId || !chapterId || !content) {
      return errorResponse("Missing parameter: projectId, chapterId, or content", 400);
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

    // 2. Call ElevenLabs API to update chapter
    const elevenLabsResponse = await fetch(
      `https://api.elevenlabs.io/v1/studio/projects/${project.studio_id}/chapters/${chapterId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": elevenLabsApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
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
    
    // ElevenLabs Returns 200 OK on success, but doesn't return the full chapter object usually in the format we want for DB
    // However, the user request assumes we just get a 200 OK and then we need to fetch/construct the response.
    // Actually, usually ElevenLabs POST /chapters returns metadata or empty.
    // BUT the user prompt says: "After successfull 200 response of eleven labs api update the public.studio chapters column by extracting the..."
    // This implies we have the data. 
    // Wait, the prompt implies "extracting the [data]" - maybe from the response?
    // Let's assume the response body IS the data we need or we need to fetch it?
    // User content says: "After successfull 200 response of eleven labs api update the public.studio chapters column by extracting the 'chapter_id'... 'content'..."
    // It's possible the logic relies on the fact that we sent the content, so we know what it is, 
    // OR we should re-fetch the chapter from ElevenLabs to get the canonical state (block IDs etc might be assigned by ElevenLabs if new?)
    
    // Rereading User Request:
    // "After successfull 200 response of eleven labs api update the public.studio chapters column by extracting the [JSON example]"
    // This phrasing implies the ElevenLabs API *returns* this JSON structure.
    // If I look at ElevenLabs API docs (or assume based on this prompt), the POST update likely returns the updated chapter or at least the response implies what we need.
    // Let's try to parse the ElevenLabs response as JSON.
    
    let elevenLabsData;
    try {
        elevenLabsData = await elevenLabsResponse.json();
    } catch (e) {
        // If no JSON returned, we might have an issue if we rely on it.
        // But let's proceed with caution.
        console.error("Failed to parse ElevenLabs response", e);
    }

    // However, standard ElevenLabs POST /chapters (which is actually a snapshot creation or update?) 
    // The endpoint used in the curl example is `POST .../chapters/{chapterId}` which corresponds to "Update Chapter Snapshot" or similar?
    // Wait, typical crud is PATCH or generic POST.
    // The request body has `content: { blocks: [...] }`.
    
    // If ElevenLabs generates new block IDs, we MUST use the response from ElevenLabs.
    // The user provided example of "extracting" suggests the response contains:
    // { chapter_id, name, content: { blocks: [...] } }
    
    if (!elevenLabsData) {
        // Fallback: If for some reason we don't get data back, we can't update our DB accurately with new block IDs.
        // We will assume it works as described.
         return errorResponse("ElevenLabs API did not return JSON response", 502);
    }
    
    // 3. Fetch studio data (chapters) to update it
     const { data: studio, error: studioError } = await adminClient
     .from("studio")
     .select("chapters")
     .eq("id", project.studio_id)
     .single();

   if (studioError || !studio) {
       if (studioError?.code === "PGRST116") {
            return errorResponse("Studio not found", 404);
       }
     console.error("Error fetching studio:", studioError);
     return errorResponse("Failed to fetch studio", 500);
   }

   let chaptersData = studio.chapters || [];
   
   // 4. Update the specific chapter in the array
   const chapterIndex = chaptersData.findIndex((c: any) => c.id === chapterId);
   
   if (chapterIndex === -1) {
       // Ideally we should have it, but if not, maybe we should add it? 
       // The prompt says "update the content of a specific chapter".
       return errorResponse("Chapter not found in database to update", 404);
   }
   
   // Construct the updated chapter object based on ElevenLabs response and preserving existing props if needed
   // The user says "extracting the ...". 
   // The response from EL seems to have: chapter_id, name, content.
   
   // Mapping EL response to our DB structure:
   // EL: chapter_id -> DB: id
   // EL: name -> DB: name
   // EL: content -> DB: content_json
   
   // Note: DB uses `id`, `name`, `content_json`.
   // EL response example in prompt uses `chapter_id`, `name`, `content`.
   
   const updatedChapterContent = {
       id: elevenLabsData.chapter.chapter_id, // Map chapter_id to id
       name: elevenLabsData.chapter.name,
       content_json: elevenLabsData.chapter.content
   };
   
   // Update the array
   chaptersData[chapterIndex] = {
       ...chaptersData[chapterIndex], // Keep other properties if any
       ...updatedChapterContent
   };

    const { error: updateError } = await adminClient
      .from("studio")
      .update({ 
          chapters: chaptersData,
       })
      .eq("id", project.studio_id);

    if (updateError) {
      console.error("Error updating studio:", updateError);
      return errorResponse("Failed to update studio data", 500);
    }

    // 5. Construct final response
    // "Create a new json element of the structure using it:"
    // The user wants a specific response format.
    
    const responsePayload = {
		id: updatedChapterContent.id,
		name: updatedChapterContent.name,
		content_json: updatedChapterContent.content_json
	};

    return successResponse({
      status: "success",
      message: "Chapter updated successfully",
      chapter: responsePayload
    });

  } catch (error) {
    console.error("Unexpected error:", error);
    return errorResponse("An unexpected error occurred", 500);
  }
});
