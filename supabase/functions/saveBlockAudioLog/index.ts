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
    const blockId = formData.get("block_id");
    const blockSnapshotStr = formData.get("block_snapshot");

    if (!projectId || !studioId || !chapterId || !blockId || !blockSnapshotStr) {
      return errorResponse("Missing required fields: project_id, studio_id, chapter_id, block_id, block_snapshot", 400);
    }

    let blockSnapshot;
    try {
        if (typeof blockSnapshotStr === 'string') {
             blockSnapshot = JSON.parse(blockSnapshotStr);
        } else {
             // Handle case where it might be a File object if user uploaded it as file, 
             // but user said "block_snapshot (json)", usually passed as string field in form data.
             return errorResponse("block_snapshot must be a JSON string", 400);
        }
    } catch (_e) {
        return errorResponse("Invalid JSON in block_snapshot", 400);
    }

    const adminClient = createAdminClient();

    // Check if row exists
    const { data: existingRow, error: fetchError } = await adminClient
      .from("block_audio_generation_log")
      .select("id")
      .eq("project_id", projectId)
      .eq("studio_id", studioId)
      .eq("chapter_id", chapterId)
      .eq("block_id", blockId)
      .single();

    if (fetchError && fetchError.code !== "PGRST116") {
      console.error("Error checking existing log:", fetchError);
      return errorResponse("Database error checking existing log", 500);
    }

    if (existingRow) {
      // Update
      const { error: updateError } = await adminClient
        .from("block_audio_generation_log")
        .update({
          block_snapshot: blockSnapshot,
          updated_at: new Date().toISOString(),
          // Optional: update credits_used if provided? User didn't specify it in input.
        })
        .eq("id", existingRow.id);

      if (updateError) {
        console.error("Error updating log:", updateError);
        return errorResponse("Failed to update log", 500);
      }

      return successResponse({
        status: "success",
        message: "Block audio log updated",
      });
    } else {
      // Insert
      const { error: insertError } = await adminClient
        .from("block_audio_generation_log")
        .insert({
          project_id: projectId,
          studio_id: studioId,
          chapter_id: chapterId,
          block_id: blockId,
          block_snapshot: blockSnapshot,
        });

      if (insertError) {
        console.error("Error inserting log:", insertError);
        return errorResponse("Failed to insert log", 500);
      }

      return successResponse({
        status: "success",
        message: "Block audio log created",
      });
    }

  } catch (error) {
    console.error("Unexpected error:", error);
    return errorResponse("Internal server error", 500);
  }
});
