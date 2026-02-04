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
    
    const studioId = project.studio_id;

    // 2. Call ElevenLabs convert API
    console.log(`Converting chapter: ${chapterId} in studio: ${studioId}`);

    const convertResponse = await fetch(
        `https://api.elevenlabs.io/v1/studio/projects/${studioId}/chapters/${chapterId}/convert`,
        {
          method: "POST",
          headers: {
            "xi-api-key": elevenLabsApiKey,
            "Content-Type": "application/json",
          },
        }
      );
      
      if (!convertResponse.ok) {
          const errorText = await convertResponse.text();
          console.error("ElevenLabs Convert Error:", errorText);
          return errorResponse(
            `ElevenLabs Convert Error: ${convertResponse.statusText}`,
            convertResponse.status
          );
      }

      // 3. Fetch snapshots list to get the latest snapshot
      const snapshotsResponse = await fetch(
        `https://api.elevenlabs.io/v1/studio/projects/${studioId}/chapters/${chapterId}/snapshots`,
        {
          method: "GET",
          headers: {
            "xi-api-key": elevenLabsApiKey,
          },
        }
      );

      if (!snapshotsResponse.ok) {
          const errorText = await snapshotsResponse.text();
          console.error("ElevenLabs Snapshots Error:", errorText);
          return errorResponse(
            `Failed to fetch snapshots: ${snapshotsResponse.statusText}`,
            snapshotsResponse.status
          );
      }

      const snapshotsData = await snapshotsResponse.json();
      
      // Get the latest snapshot (assuming snapshots are returned in order, or we sort by created_at_unix)
      const snapshots = snapshotsData.snapshots || [];
      
      if (snapshots.length === 0) {
          return errorResponse("No snapshots found after conversion", 404);
      }

      // Sort by created_at_unix descending to get the latest
      snapshots.sort((a: any, b: any) => b.created_at_unix - a.created_at_unix);
      const latestSnapshot = snapshots[0];

      // Convert Unix timestamp to ISO 8601 format
      const createdAtTimestamp = new Date(latestSnapshot.created_at_unix * 1000).toISOString();

      return successResponse({
        status: "success",
        message: "Chapter conversion completed successfully",
        data: {
          chapter_snapshot_id: latestSnapshot.chapter_snapshot_id,
          project_id: latestSnapshot.project_id,
          chapter_id: latestSnapshot.chapter_id,
          created_at: createdAtTimestamp,
          name: latestSnapshot.name
        }
      }, 200);

  } catch (error) {
    console.error("Unexpected error:", error);
    return errorResponse("An unexpected error occurred", 500);
  }
});
