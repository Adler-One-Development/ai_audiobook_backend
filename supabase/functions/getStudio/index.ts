import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  errorResponse,
  handleCorsPreFlight,
  successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";
import { StudioBook, StudioChapter, GetStudioResponse } from "../_shared/types.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight();
  }

  try {
    const { user, error: authError } = await getAuthenticatedUser(req);
    if (authError || !user) return authError;

    // Get projectId from query params
    const projectId = new URL(req.url).searchParams.get("projectId");

    if (!projectId) {
      return errorResponse("Missing parameter: projectId", 400);
    }

    const adminClient = createAdminClient();

    // 1. Get project and verify access + get studio_id and book
    const { data: project, error: projectError } = await adminClient
      .from("projects")
      .select("studio_id, book")
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

    // 2. Fetch studio data (chapters, gallery_id)
    const { data: studio, error: studioError } = await adminClient
      .from("studio")
      .select("chapters, gallery_id")
      .eq("id", project.studio_id)
      .single();

    if (studioError || !studio) {
        if (studioError?.code === "PGRST116") {
             return errorResponse("Studio not found", 404);
        }
      console.error("Error fetching studio:", studioError);
      return errorResponse("Failed to fetch studio", 500);
    }

    // Process chapters to return only id and name
    const chaptersData = studio.chapters || [];
    
    const processedChapters: StudioChapter[] = chaptersData.map((chapter: any) => ({
        id: chapter.id,
        name: chapter.name
    }));

    // Deserialize book object if it's a string
    let bookData: StudioBook = project.book;
    if (typeof bookData === 'string') {
        try {
            bookData = JSON.parse(bookData);
        } catch (e) {
            console.error("Error parsing book JSON:", e);
             // fallback to original if parse fails, or empty object? 
             // keeping as is if fail usually safest unless strict schema
        }
    }


    const responseData: GetStudioResponse = {
        book: bookData,
        chapters: processedChapters,
        gallery_id: studio.gallery_id,
    };

    return successResponse({
      status: "success",
      message: "Studio retrieved successfully",
      studio: responseData,
    }, 200);

  } catch (error) {
    console.error("Unexpected error:", error);
    return errorResponse("An unexpected error occurred", 500);
  }
});
