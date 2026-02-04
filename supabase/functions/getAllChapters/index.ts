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

    // 2. Fetch studio data (chapters, comments)
    const { data: studio, error: studioError } = await adminClient
      .from("studio")
      .select("chapters, comments")
      .eq("id", project.studio_id)
      .single();

    if (studioError || !studio) {
        if (studioError?.code === "PGRST116") {
             return errorResponse("Studio not found", 404);
        }
      console.error("Error fetching studio:", studioError);
      return errorResponse("Failed to fetch studio", 500);
    }

    // 3. Process chapters
    const chaptersData = studio.chapters || [];
    const allComments = studio.comments || [];

    const processedChapters = chaptersData.map((chapter: any) => {
        let totalText = "";
        let enrichedBlocks: any[] = [];

        if (chapter.content_json && Array.isArray(chapter.content_json.blocks)) {
            enrichedBlocks = chapter.content_json.blocks.map((block: any) => {
                // Determine block comments
                const blockComments = allComments.filter((c: any) => c.block_id === block.block_id);
                
                // Text calculation
                if (Array.isArray(block.nodes)) {
                    block.nodes.forEach((node: any) => {
                        if (node.text) {
                            totalText += node.text + " ";
                        }
                    });
                }

                return {
                    ...block,
                    comments: blockComments
                };
            });
        }

        const trimmedText = totalText.trim();
        const characterCount = trimmedText.length;
        const wordCount = trimmedText ? trimmedText.split(/\s+/).length : 0;
        
        // 1 credit = 1000 characters
        const creditsUsed = characterCount / 1000;

        return {
            title: chapter.name,
            chapter_id: chapter.id,
            word_count: wordCount,
            //chapterDuration: 0, 
            creditsUsed: creditsUsed,
            content: {
                blocks: enrichedBlocks
            }
        };
    });

    return successResponse({
      status: "success",
      message: "Chapters retrieved successfully",
      chapters: processedChapters,
    }, 200);

  } catch (error) {
    console.error("Unexpected error:", error);
    return errorResponse("An unexpected error occurred", 500);
  }
});
