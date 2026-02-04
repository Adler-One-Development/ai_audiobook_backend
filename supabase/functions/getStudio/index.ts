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

    // Parse request body
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return errorResponse("Invalid JSON body", 400);
    }

    const { projectId } = body;

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

    // 2. Fetch studio data (chapters, gallery_id, comments)
    const { data: studio, error: studioError } = await adminClient
      .from("studio")
      .select("chapters, gallery_id, comments")
      .eq("id", project.studio_id)
      .single();

    if (studioError || !studio) {
        if (studioError?.code === "PGRST116") {
             return errorResponse("Studio not found", 404);
        }
      console.error("Error fetching studio:", studioError);
      return errorResponse("Failed to fetch studio", 500);
    }

    // Response Model
    interface Chapter {
        id: string;
        name: string;
        content_json: any; 
    }

    interface GetStudioResponse {
        book: any;
        chapters: Chapter[];
        gallery_id: string;
    }

    // Process chapters to inject comments
    const chaptersData = studio.chapters || [];
    const allComments = studio.comments || [];

    const processedChapters = chaptersData.map((chapter: any) => {
        if (chapter.content_json && Array.isArray(chapter.content_json.blocks)) {
            const enrichedBlocks = chapter.content_json.blocks.map((block: any) => {
                // Determine block comments
                const blockComments = allComments.filter((c: any) => c.block_id === block.block_id);
                return {
                    ...block,
                    comments: blockComments
                };
            });
            return {
                ...chapter,
                content_json: {
                    ...chapter.content_json,
                    blocks: enrichedBlocks
                }
            };
        }
        return chapter;
    });

    const responseData: GetStudioResponse = {
        book: project.book,
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
