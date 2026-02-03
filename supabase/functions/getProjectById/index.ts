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

        // Get project ID from query params
        const url = new URL(req.url);
        const projectId = url.searchParams.get("id");

        if (!projectId) {
            return errorResponse("Missing project ID", 400);
        }

        const adminClient = createAdminClient();

        // Fetch project, ensuring user has access (owner OR in access_levels)
        const { data: project, error: projectError } = await adminClient
            .from("projects")
            .select("*, gallery:galleries(*), genre:genres(*)")
            .eq("id", projectId)
            .or(`owner_id.eq.${user.id},access_levels.cs.{${user.id}}`)
            .single();

        if (projectError || !project) {
            if (projectError?.code === "PGRST116") { // No rows returned
                return errorResponse("Project not found or access denied", 404);
            }
            console.error("Error fetching project:", projectError);
            return errorResponse("Failed to fetch project", 500);
        }

        // Update chapters_and_pages based on studio chapter count
        if (project.studio_id) {
            const { data: studio } = await adminClient
                .from("studio")
                .select("chapters")
                .eq("id", project.studio_id)
                .single();

            if (studio && studio.chapters) {
                const chapterCount = Array.isArray(studio.chapters)
                    ? studio.chapters.length
                    : 0;
                const chaptersText = `${chapterCount} Chapter${
                    chapterCount !== 1 ? "s" : ""
                }`;

                // Update the project's chapters_and_pages field
                await adminClient
                    .from("projects")
                    .update({ chapters_and_pages: chaptersText })
                    .eq("id", project.id);

                // Update the returned project object
                project.chapters_and_pages = chaptersText;
            }
        }

        return successResponse({
            status: "success",
            message: "Project retrieved successfully",
            project,
        }, 200);
    } catch (error) {
        console.error("Unexpected error:", error);
        return errorResponse("An unexpected error occurred", 500);
    }
});
