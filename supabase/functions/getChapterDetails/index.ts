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
    const projectId = url.searchParams.get("projectId");

    if (!projectId) {
      return errorResponse("Missing parameter: projectId", 400);
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

    // 2. Fetch studio data (chapters only)
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

    const chapters = studio.chapters || [];

    // 3. Process statistics
    const chapterDetails = chapters.map((chapter: any) => {
        let totalText = "";

        if (chapter.content_json && Array.isArray(chapter.content_json.blocks)) {
             chapter.content_json.blocks.forEach((block: any) => {
                if (Array.isArray(block.nodes)) {
                    block.nodes.forEach((node: any) => {
                        if (node.text) {
                            totalText += node.text; // Concatenate without space for strict char count? Or with space? 
                            // Usually with space for word count, but for credits char count might need to be exact.
                            // Adding space to match logic in other functions usually better for tokenization.
                             totalText += " ";
                        }
                    });
                }
             });
        }

        const trimmedText = totalText.trim();
        const characterCount = trimmedText.length;
        const wordCount = trimmedText ? trimmedText.split(/\s+/).length : 0;
        
        // 1 credit = 1000 characters
        const creditsUsed = characterCount / 1000;

        return {
            chapterId: chapter.id,
            chapterTitle: chapter.name,
            wordCount: wordCount,
            estimatedCreditsUsed: creditsUsed
        };
    });

    return successResponse({
      status: "success",
      message: "Chapter details retrieved successfully",
      data: chapterDetails,
    }, 200);

  } catch (error) {
    console.error("Unexpected error:", error);
    return errorResponse("An unexpected error occurred", 500);
  }
});
