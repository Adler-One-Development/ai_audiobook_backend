import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "DELETE, OPTIONS",
                "Access-Control-Allow-Headers":
                    "authorization, x-client-info, apikey, content-type",
            },
        });
    }

    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
            "authorization, x-client-info, apikey, content-type",
        "Content-Type": "application/json",
    };

    try {
        // Get the authorization header
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(
                JSON.stringify({
                    status: "error",
                    message: "Missing authorization header",
                }),
                { status: 401, headers: corsHeaders },
            );
        }

        // Initialize Supabase client
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
        const supabaseClient = createClient(supabaseUrl, supabaseKey, {
            global: {
                headers: { Authorization: authHeader },
            },
        });

        // Get the authenticated user
        const {
            data: { user },
            error: userError,
        } = await supabaseClient.auth.getUser();

        if (userError || !user) {
            return new Response(
                JSON.stringify({
                    status: "error",
                    message: "Unauthorized",
                }),
                { status: 401, headers: corsHeaders },
            );
        }

        // Get project ID from query parameters
        const url = new URL(req.url);
        const projectId = url.searchParams.get("id");

        if (!projectId) {
            return new Response(
                JSON.stringify({
                    status: "error",
                    message: "Missing required parameter: id",
                }),
                { status: 400, headers: corsHeaders },
            );
        }

        // Create admin client for database operations
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const adminClient = createClient(supabaseUrl, supabaseServiceKey);

        // Fetch the project
        const { data: project, error: projectError } = await adminClient
            .from("projects")
            .select("id, owner_id, studio_id, gallery_id")
            .eq("id", projectId)
            .single();

        if (projectError || !project) {
            return new Response(
                JSON.stringify({
                    status: "error",
                    message: "Project not found",
                }),
                { status: 404, headers: corsHeaders },
            );
        }

        // Check authorization - only owner can delete
        if (project.owner_id !== user.id) {
            return new Response(
                JSON.stringify({
                    status: "error",
                    message: "Unauthorized to delete this project",
                }),
                { status: 403, headers: corsHeaders },
            );
        }

        // Collect gallery IDs to delete
        const galleryIdsToDelete: string[] = [];
        if (project.gallery_id) {
            galleryIdsToDelete.push(project.gallery_id);
        }

        // Fetch studio if it exists to get its gallery_id
        let studioGalleryId = null;
        if (project.studio_id) {
            const { data: studio } = await adminClient
                .from("studio")
                .select("gallery_id")
                .eq("id", project.studio_id)
                .single();

            if (studio?.gallery_id) {
                studioGalleryId = studio.gallery_id;
                // Only add if it's different from project's gallery_id
                if (!galleryIdsToDelete.includes(studio.gallery_id)) {
                    galleryIdsToDelete.push(studio.gallery_id);
                }
            }
        }

        // Fetch gallery records to get file paths for deletion
        const filesToDelete: Array<{ bucket: string; path: string }> = [];

        for (const galleryId of galleryIdsToDelete) {
            const { data: gallery } = await adminClient
                .from("galleries")
                .select("cover_image, files")
                .eq("id", galleryId)
                .single();

            if (gallery) {
                // Extract cover image path
                if (gallery.cover_image?.path) {
                    filesToDelete.push({
                        bucket: "cover_images",
                        path: gallery.cover_image.path,
                    });
                }

                // Extract file paths
                if (Array.isArray(gallery.files)) {
                    for (const file of gallery.files) {
                        if (file?.path) {
                            filesToDelete.push({
                                bucket: "files",
                                path: file.path,
                            });
                        }
                    }
                }
            }
        }

        // Delete files from storage buckets
        for (const file of filesToDelete) {
            try {
                const { error: deleteError } = await adminClient.storage
                    .from(file.bucket)
                    .remove([file.path]);

                if (deleteError) {
                    console.error(
                        `Warning: Failed to delete file ${file.path} from bucket ${file.bucket}:`,
                        deleteError,
                    );
                    // Continue with other deletions even if file deletion fails
                }
            } catch (error) {
                console.error(
                    `Warning: Error deleting file ${file.path}:`,
                    error,
                );
                // Continue with other deletions
            }
        }

        // Delete studio record
        if (project.studio_id) {
            const { error: studioDeleteError } = await adminClient
                .from("studio")
                .delete()
                .eq("id", project.studio_id);

            if (studioDeleteError) {
                console.error("Error deleting studio:", studioDeleteError);
                return new Response(
                    JSON.stringify({
                        status: "error",
                        message: "Failed to delete studio record",
                    }),
                    { status: 500, headers: corsHeaders },
                );
            }
        }

        // Delete gallery records
        for (const galleryId of galleryIdsToDelete) {
            const { error: galleryDeleteError } = await adminClient
                .from("galleries")
                .delete()
                .eq("id", galleryId);

            if (galleryDeleteError) {
                console.error("Error deleting gallery:", galleryDeleteError);
                // Continue to try to delete the project anyway
            }
        }

        // Delete project record
        const { error: projectDeleteError } = await adminClient
            .from("projects")
            .delete()
            .eq("id", projectId);

        if (projectDeleteError) {
            console.error("Error deleting project:", projectDeleteError);
            return new Response(
                JSON.stringify({
                    status: "error",
                    message: "Failed to delete project record",
                }),
                { status: 500, headers: corsHeaders },
            );
        }

        // Return success response
        return new Response(
            JSON.stringify({
                status: "success",
                message:
                    "Project and associated resources deleted successfully",
                deleted: {
                    project: projectId,
                    studio: project.studio_id || null,
                    galleries: galleryIdsToDelete,
                    files: filesToDelete.length,
                },
            }),
            { status: 200, headers: corsHeaders },
        );
    } catch (error) {
        console.error("Error in deleteProjectById:", error);
        return new Response(
            JSON.stringify({
                status: "error",
                message: error instanceof Error
                    ? error.message
                    : "Unknown error",
            }),
            { status: 500, headers: corsHeaders },
        );
    }
});
