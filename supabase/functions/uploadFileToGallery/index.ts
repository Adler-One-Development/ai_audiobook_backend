import { createClient } from "jsr:@supabase/supabase-js@2";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";

/**
 * uploadFileToGallery Edge Function
 *
 * Uploads a file to storage and adds it to a gallery's files array.
 * Logic:
 * 1. Accept gallery_id and file in multipart form data
 * 2. Validate file type (same MIME types as createNewProject)
 * 3. Upload file to storage bucket
 * 4. Add file entry to gallery's files JSONB array
 * 5. Return success with file details
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

        // Parse multipart form data
        const formData = await req.formData();
        const galleryId = formData.get("gallery_id")?.toString();
        const file = formData.get("file") as File | null;

        if (!galleryId || !file) {
            return errorResponse(
                "Missing required fields: gallery_id and file",
                400,
            );
        }

        // Validate file type - same logic as createNewProject
        const allowedMimeTypes = [
            // PDF
            "application/pdf",
            // Audio formats
            "audio/mpeg", // MP3
            "audio/mp3",
            "audio/wav",
            "audio/wave",
            "audio/x-wav",
            "audio/aac",
            "audio/ogg",
            "audio/flac",
            // Word documents
            "application/msword", // DOC
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // DOCX
            // EPUB
            "application/epub+zip",
            // Text files
            "text/plain",
            "text/markdown",
        ];

        const allowedExtensions = [
            "pdf",
            "mp3",
            "wav",
            "aac",
            "ogg",
            "flac",
            "doc",
            "docx",
            "epub",
            "txt",
            "md",
        ];

        const fileType = file.type;
        const fileName = file.name.toLowerCase();
        const fileExtension = fileName.split(".").pop() || "";

        // Check MIME type or file extension
        const isValidMimeType = allowedMimeTypes.includes(fileType);
        const isValidExtension = allowedExtensions.includes(fileExtension);

        if (!isValidMimeType && !isValidExtension) {
            return errorResponse(
                `Unsupported file type. Allowed formats: PDF, MP3, WAV, AAC, OGG, FLAC, DOC, DOCX, EPUB, TXT, MD. Received: ${
                    fileType || fileExtension
                }`,
                400,
            );
        }

        // Verify gallery exists
        const { data: gallery, error: galleryError } = await supabase
            .from("galleries")
            .select("*")
            .eq("id", galleryId)
            .single();

        if (galleryError || !gallery) {
            return errorResponse("Gallery not found", 404);
        }

        // Upload file to storage
        const adminClient = createAdminClient();
        const fileExt = file.name.split(".").pop();
        const storageFileName = `${crypto.randomUUID()}.${fileExt}`;

        const { error: uploadError } = await adminClient.storage
            .from("files")
            .upload(storageFileName, file, {
                contentType: file.type,
                upsert: false,
            });

        if (uploadError) {
            console.error("File upload error:", uploadError);
            return errorResponse("Failed to upload file", 500);
        }

        // Get public URL
        const { data: publicUrlData } = adminClient.storage
            .from("files")
            .getPublicUrl(storageFileName);

        const fileUrl = publicUrlData.publicUrl;
        const fileId = crypto.randomUUID();

        // Add file to gallery's files array
        const currentFiles = gallery.files || [];
        const newFile = {
            id: fileId,
            url: fileUrl,
        };
        const updatedFiles = [...currentFiles, newFile];

        const { error: updateError } = await supabase
            .from("galleries")
            .update({ files: updatedFiles })
            .eq("id", galleryId);

        if (updateError) {
            console.error("Error updating gallery:", updateError);
            // Try to clean up uploaded file
            await adminClient.storage.from("files").remove([storageFileName]);
            return errorResponse("Failed to update gallery", 500);
        }

        return successResponse({
            status: "success",
            message: "File uploaded successfully",
            file: newFile,
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
