import { createClient } from "jsr:@supabase/supabase-js@2";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";

/**
 * deleteFileFromGallery Edge Function
 *
 * Deletes a file from both the storage bucket and the gallery JSONB array.
 * Logic:
 * 1. Accept `id` in request body (file UUID)
 * 2. Query all galleries to find which one contains this file
 * 3. Extract the file's URL to determine the storage path
 * 4. Delete the file from the storage bucket
 * 5. Update the gallery by removing the file from the JSONB array
 * 6. Return success response
 */
Deno.serve(async (req) => {
    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        // Initialize Supabase client
        const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
        const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
        const authHeader = req.headers.get("Authorization");

        if (!authHeader) {
            return errorResponse("Missing Authorization header", 401);
        }

        const supabase = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: authHeader } },
        });

        // Verify user authentication
        const { data: { user }, error: authError } = await supabase.auth
            .getUser();

        if (authError || !user) {
            return errorResponse("Invalid token", 401);
        }

        // Parse request body
        const body = await req.json();
        const fileId = body.id;

        if (!fileId) {
            return errorResponse("Missing required parameter: id", 400);
        }

        // 1. Find the gallery containing this file
        // We need to search through all galleries since files are stored in JSONB
        const { data: galleries, error: galleriesError } = await supabase
            .from("galleries")
            .select("*");

        if (galleriesError) {
            console.error("Error fetching galleries:", galleriesError);
            return errorResponse("Failed to fetch galleries", 500);
        }

        if (!galleries || galleries.length === 0) {
            return errorResponse("No galleries found", 404);
        }

        // Find which gallery contains the file with this ID
        let targetGallery: any = null;
        let targetFile: { id: string; url: string } | null = null;

        for (const gallery of galleries) {
            if (gallery.files && Array.isArray(gallery.files)) {
                const file = gallery.files.find((
                    f: { id: string; url: string },
                ) => f.id === fileId);
                if (file) {
                    targetGallery = gallery;
                    targetFile = file;
                    break;
                }
            }
        }

        if (!targetGallery || !targetFile) {
            return errorResponse("File not found in any gallery", 404);
        }

        // 2. Extract the file path from the URL
        // URL format: https://...supabase.co/storage/v1/object/public/files/<path>
        const fileUrl = targetFile.url;
        const urlParts = fileUrl.split("/files/");
        if (urlParts.length < 2) {
            return errorResponse("Invalid file URL format", 500);
        }
        const filePath = urlParts[1];

        // 3. Delete the file from the storage bucket
        const { error: deleteStorageError } = await supabase.storage
            .from("files")
            .remove([filePath]);

        if (deleteStorageError) {
            console.error(
                "Error deleting file from storage:",
                deleteStorageError,
            );
            return errorResponse(
                "Failed to delete file from storage",
                500,
                [deleteStorageError.message],
            );
        }

        // 4. Remove the file from the gallery's files JSONB array
        const updatedFiles = targetGallery.files.filter(
            (f: { id: string; url: string }) => f.id !== fileId,
        );

        const { error: updateError } = await supabase
            .from("galleries")
            .update({ files: updatedFiles })
            .eq("id", targetGallery.id);

        if (updateError) {
            console.error("Error updating gallery:", updateError);
            return errorResponse(
                "Failed to update gallery",
                500,
                [updateError.message],
            );
        }

        return successResponse({
            status: "success",
            message: "File deleted successfully",
        });
    } catch (err) {
        console.error("Unexpected error:", err);
        const errorMessage = err instanceof Error
            ? err.message
            : "Unknown error";
        return errorResponse(
            "Internal server error",
            500,
            [errorMessage],
        );
    }
});
