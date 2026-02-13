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

    const url = new URL(req.url);
    const projectId = url.searchParams.get("project_id");
    const studioId = url.searchParams.get("studio_id");
    const chapterId = url.searchParams.get("chapter_id");

    if (!projectId || !studioId || !chapterId) {
      return errorResponse("Missing required parameters: project_id, studio_id, chapter_id", 400);
    }

    const adminClient = createAdminClient();

    const { data, error } = await adminClient
      .from("chapter_audio_generation_log")
      .select("chapter_snapshot")
      .eq("project_id", projectId)
      .eq("studio_id", studioId)
      .eq("chapter_id", chapterId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error) {
       if (error.code === "PGRST116") {
        return successResponse({
          status: "success",
          message: "Chapter log not found",
          exists: false,
          chapter_snapshot: null,
        });
      }
      console.error("Error fetching chapter log:", error);
      return errorResponse("Failed to fetch chapter log", 500);
    }

    return successResponse({
      status: "success",
      message: "Chapter log retrieved successfully",
      exists: true,
      chapter_snapshot: data.chapter_snapshot,
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    return errorResponse("Internal server error", 500);
  }
});
