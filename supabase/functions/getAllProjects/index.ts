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

        const adminClient = createAdminClient();

        // Query projects where user is owner OR user's ID is in access_levels
        // Note: access_levels is UUID[], so we use the 'cs' (contains) operator.
        // But since we want OR condition across columns, it's slightly complex with simple Supabase filters.
        // It's easier to use .or() syntax.

        // Parse pagination params
        const url = new URL(req.url);
        const page = parseInt(url.searchParams.get("page") || "1");
        const limit = parseInt(url.searchParams.get("limit") || "10");
        const from = (page - 1) * limit;
        const to = from + limit - 1;

        const { data: projects, count, error: projectsError } =
            await adminClient
                .from("projects")
                .select("*, gallery:galleries(*), genre:genres(*)", {
                    count: "exact",
                })
                .or(`owner_id.eq.${user.id},access_levels.cs.{${user.id}}`)
                .range(from, to)
                .order("created_at", { ascending: false });

        if (projectsError) {
            console.error("Error fetching projects:", projectsError);
            return errorResponse(
                `Failed to fetch projects: ${JSON.stringify(projectsError)}`,
                500,
            );
        }

        // Update chapters_and_pages for each project based on studio chapter count
        const updatedProjects = await Promise.all(
            (projects || []).map(async (project) => {
                if (project.studio_id) {
                    // Fetch studio to get chapter count
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
                return project;
            }),
        );

        const total = count || 0;
        const totalPages = Math.ceil(total / limit);

        return successResponse({
            status: "success",
            message: "Projects retrieved successfully",
            data: updatedProjects,
            meta: {
                total,
                page,
                limit,
                totalPages,
            },
        }, 200);
    } catch (error) {
        console.error("Unexpected error:", error);
        return errorResponse("An unexpected error occurred", 500);
    }
});
