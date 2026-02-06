import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  errorResponse,
  handleCorsPreFlight,
  successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";

interface ElevenLabsProjectSnapshot {
    project_snapshot_id: string;
    project_id: string;
    created_at_unix: number;
    name: string;
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

    const { searchParams } = new URL(req.url);
    const project_id = searchParams.get("project_id");

    if (!project_id) {
      return errorResponse("Missing parameter: project_id", 400);
    }

    const adminClient = createAdminClient();

    // 1. Get project and verify access + get studio_id
    const { data: project, error: projectError } = await adminClient
      .from("projects")
      .select("studio_id")
      .eq("id", project_id)
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

    // 2. Call ElevenLabs API
    const elevenLabsUrl = `https://api.elevenlabs.io/v1/studio/projects/${studioId}/snapshots`;
    
    const elResponse = await fetch(elevenLabsUrl, {
        method: "GET",
        headers: {
            "xi-api-key": elevenLabsApiKey
        }
    });

    if (!elResponse.ok) {
        const errorText = await elResponse.text();
        console.error("ElevenLabs API Error:", errorText);
        
        // Pass through 404 if project not found, or other errors
        if (elResponse.status === 404) {
             return errorResponse("Project snapshots not found or access denied (ElevenLabs)", 404);
        }
        return errorResponse(`ElevenLabs API Error: ${elResponse.statusText}`, elResponse.status);
    }

    const elData = await elResponse.json();
    const snapshots: ElevenLabsProjectSnapshot[] = elData.snapshots || [];

    if (snapshots.length === 0) {
        return successResponse({
            status: "success",
            message: "Project needs to be converted",
            snapshots: []
        });
    }

    // 3. Transform Response
    const transformedSnapshots = snapshots
        .sort((a, b) => b.created_at_unix - a.created_at_unix)
        .map((snapshot) => ({
            project_snapshot_id: snapshot.project_snapshot_id,
            studio_id: snapshot.project_id, // Rename project_id to studio_id
            created_at_unix: snapshot.created_at_unix,
            created_at: new Date(snapshot.created_at_unix * 1000).toLocaleString(),
            name: snapshot.name
        }));

    return successResponse({
        status: "success",
        message: "Snapshots retrieved successfully",
        snapshots: transformedSnapshots
    });

  } catch (error) {
    console.error("Unexpected error:", error);
    return errorResponse("An unexpected error occurred", 500);
  }
});
