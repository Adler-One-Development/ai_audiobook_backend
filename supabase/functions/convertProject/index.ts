
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

    // Parse specific FormData
    let project_id: string | null = null;
    try {
        const formData = await req.formData();
        project_id = formData.get("project_id") as string;
    } catch (e) {
        return errorResponse("Invalid FormData", 400);
    }

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

    // 2. Call ElevenLabs Convert API
    console.log(`Converting project ${project_id} (Studio ID: ${studioId})...`);
    const convertUrl = `https://api.elevenlabs.io/v1/studio/projects/${studioId}/convert`;
    
    const convertResponse = await fetch(convertUrl, {
        method: "POST",
        headers: {
            "xi-api-key": elevenLabsApiKey
        }
    });

    if (!convertResponse.ok) {
        const errorText = await convertResponse.text();
        console.error("ElevenLabs Convert API Error:", errorText);
        return errorResponse(`ElevenLabs Convert API Error: ${convertResponse.statusText}`, convertResponse.status);
    }

    console.log("Conversion started successfully. Waiting 10s...");

    // 3. Wait for 10 seconds
    await new Promise(resolve => setTimeout(resolve, 10000));

    // 4. Call ElevenLabs Snapshots API to get the result
    const snapshotsUrl = `https://api.elevenlabs.io/v1/studio/projects/${studioId}/snapshots`;
    
    const snapshotsResponse = await fetch(snapshotsUrl, {
        method: "GET",
        headers: {
            "xi-api-key": elevenLabsApiKey
        }
    });

    if (!snapshotsResponse.ok) {
        const errorText = await snapshotsResponse.text();
        console.error("ElevenLabs Snapshots API Error:", errorText);
        return errorResponse(`ElevenLabs Snapshots API Error: ${snapshotsResponse.statusText}`, snapshotsResponse.status);
    }

    const elData = await snapshotsResponse.json();
    const snapshots: ElevenLabsProjectSnapshot[] = elData.snapshots || [];

    if (snapshots.length === 0) {
        // Even after conversion, if no snapshots found, something might be wrong or it takes longer
         return successResponse({
            status: "success",
            message: "Conversion triggered, but no snapshots available yet.",
            project_snapshot: null
        });
    }

    // 5. Get Latest Snapshot
    const latestSnapshot = snapshots.sort((a, b) => b.created_at_unix - a.created_at_unix)[0];

    // 6. Transform Response
    const transformedSnapshot = {
        project_snapshot_id: latestSnapshot.project_snapshot_id,
        studio_id: latestSnapshot.project_id, // Rename project_id to studio_id for consistency with requirement
        created_at_unix: latestSnapshot.created_at_unix,
        created_at: new Date(latestSnapshot.created_at_unix * 1000).toLocaleString(),
        name: latestSnapshot.name
    };

    return successResponse(transformedSnapshot);

  } catch (error) {
    console.error("Unexpected error:", error);
    return errorResponse("An unexpected error occurred", 500);
  }
});
