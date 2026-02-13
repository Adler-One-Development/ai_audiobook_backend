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

    // Parse Multipart Form Data
    let formData;
    try {
      formData = await req.formData();
    } catch (_e) {
      return errorResponse("Invalid form data", 400);
    }

    const projectId = formData.get("project_id");
    const studioId = formData.get("studio_id");
    const chapterId = formData.get("chapter_id");
    const chapterSnapshotStr = formData.get("chapter_snapshot");

    if (!projectId || !studioId || !chapterId || !chapterSnapshotStr) {
      return errorResponse("Missing required fields: project_id, studio_id, chapter_id, chapter_snapshot", 400);
    }

    let chapterSnapshot;
    try {
        if (typeof chapterSnapshotStr === 'string') {
             chapterSnapshot = JSON.parse(chapterSnapshotStr);
        } else {
             return errorResponse("chapter_snapshot must be a JSON string", 400);
        }
    } catch (_e) {
        return errorResponse("Invalid JSON in chapter_snapshot", 400);
    }

    const adminClient = createAdminClient();

    // Check if row exists
    const { data: existingRow, error: fetchError } = await adminClient
      .from("chapter_audio_generation_log")
      .select("id")
      .eq("project_id", projectId)
      .eq("studio_id", studioId)
      .eq("chapter_id", chapterId)
      .single();

    if (fetchError && fetchError.code !== "PGRST116") {
      console.error("Error checking existing log:", fetchError);
      return errorResponse("Database error checking existing log", 500);
    }

    if (existingRow) {
      // Update
      const { error: updateError } = await adminClient
        .from("chapter_audio_generation_log")
        .update({
          chapter_snapshot: chapterSnapshot,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingRow.id);

      if (updateError) {
        console.error("Error updating log:", updateError);
        return errorResponse("Failed to update log", 500);
      }

      return successResponse({
        status: "success",
        message: "Chapter audio log updated",
      });
    } else {
      // Insert
      const { error: insertError } = await adminClient
        .from("chapter_audio_generation_log")
        .insert({
          project_id: projectId,
          studio_id: studioId,
          chapter_id: chapterId,
          chapter_snapshot: chapterSnapshot,
        });

      if (insertError) {
        console.error("Error inserting log:", insertError);
        return errorResponse("Failed to insert log", 500);
      }

      return successResponse({
        status: "success",
        message: "Chapter audio log created",
      });
    }

  } catch (error) {
    console.error("Unexpected error:", error);
    return errorResponse("Internal server error", 500);
  }
});
