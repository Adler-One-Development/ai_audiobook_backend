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

        // Parse query parameters
        const url = new URL(req.url);
        const page = parseInt(url.searchParams.get("page") || "1");
        const limit = parseInt(url.searchParams.get("limit") || "10");
        const search = url.searchParams.get("search")?.trim() || "";
        const genreId = url.searchParams.get("genre")?.trim() || "";
        const status = url.searchParams.get("status")?.trim() || "";
        const durationMin = url.searchParams.get("duration_min")?.trim() || "";
        const durationMax = url.searchParams.get("duration_max")?.trim() || "";

        const from = (page - 1) * limit;
        const to = from + limit - 1;

        // Build the query
        let query = adminClient
            .from("projects")
            .select("*, gallery:galleries(*), genre:genres(*)", {
                count: "exact",
            })
            .or(`owner_id.eq.${user.id},access_levels.cs.{${user.id}}`);

        // Apply search filter (search in title, author, description)
        if (search) {
            query = query.or(
                `book->title.ilike.%${search}%,book->author.ilike.%${search}%,book->description.ilike.%${search}%`,
            );
        }

        // Apply genre filter
        if (genreId) {
            query = query.eq("genre_id", genreId);
        }

        // Apply status filter
        if (status) {
            const validStatuses = ["Processing", "InProgress", "Completed"];
            if (validStatuses.includes(status)) {
                query = query.eq("status", status);
            } else {
                return errorResponse(
                    `Invalid status. Must be one of: ${
                        validStatuses.join(", ")
                    }`,
                    400,
                );
            }
        }

        // Apply duration filters
        if (durationMin) {
            query = query.gte("duration", durationMin);
        }
        if (durationMax) {
            query = query.lte("duration", durationMax);
        }

        // Apply pagination and ordering
        const { data: projects, count, error: projectsError } = await query
            .range(from, to)
            .order("created_at", { ascending: false });

        if (projectsError) {
            console.error("Error searching projects:", projectsError);
            return errorResponse(
                `Failed to search projects: ${JSON.stringify(projectsError)}`,
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
            message: "Projects searched successfully",
            data: updatedProjects,
            meta: {
                total,
                page,
                limit,
                totalPages,
            },
            filters: {
                search: search || null,
                genre: genreId || null,
                status: status || null,
                duration_min: durationMin || null,
                duration_max: durationMax || null,
            },
        }, 200);
    } catch (error) {
        console.error("Unexpected error:", error);
        return errorResponse("An unexpected error occurred", 500);
    }
});
