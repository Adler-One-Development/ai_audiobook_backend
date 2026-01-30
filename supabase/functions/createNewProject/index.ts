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

        // Get user's organization info
        const { data: userData, error: userError } = await adminClient
            .from("users")
            .select("organization_id, user_type")
            .eq("id", user.id)
            .single();

        if (userError || !userData?.organization_id) {
            return errorResponse(
                "User must belong to an organization to create a project",
                403,
            );
        }

        // Parse multipart/form-data
        const formData = await req.formData();
        const title = formData.get("title")?.toString();
        const author = formData.get("author")?.toString();
        const genreId = formData.get("genre_id")?.toString();
        const description = formData.get("description")?.toString();
        const isbn = formData.get("isbn")?.toString() || "";
        const publisherName = formData.get("publisher_name")?.toString() || "";
        const publicationDate = formData.get("publication_date")?.toString() ||
            "";

        const coverImageFile = formData.get("cover_image") as File | null;
        const manuscriptFile = formData.get("manuscript") as File | null;

        // Validation
        if (!title || !author || !genreId || !description || !manuscriptFile) {
            return errorResponse(
                "Missing mandatory fields: title, author, genre_id, description, manuscript",
                400,
            );
        }

        // Validate Genre
        const { data: genre, error: genreError } = await adminClient
            .from("genres")
            .select("id")
            .eq("id", genreId)
            .single();

        if (genreError || !genre) {
            return errorResponse("Invalid genre_id", 400);
        }

        // Upload files
        let coverImageUrl = "";
        let coverImageId = "";

        if (coverImageFile) {
            const fileExt = coverImageFile.name.split(".").pop();
            const fileName = `${crypto.randomUUID()}.${fileExt}`;
            const { data: uploadData, error: uploadError } = await adminClient
                .storage
                .from("cover_images")
                .upload(fileName, coverImageFile, {
                    contentType: coverImageFile.type,
                    upsert: false,
                });

            if (uploadError) {
                console.error("Cover image upload error:", uploadError);
                return errorResponse("Failed to upload cover image", 500);
            }

            const { data: publicUrlData } = adminClient.storage
                .from("cover_images")
                .getPublicUrl(fileName);

            coverImageUrl = publicUrlData.publicUrl;
            coverImageId = crypto.randomUUID(); // In a real scenario we might track storage ID differently, but here we just need a UUID for the gallery structure
        }

        // Upload Manuscript
        const manusFileExt = manuscriptFile.name.split(".").pop();
        const manusFileName = `${crypto.randomUUID()}.${manusFileExt}`;
        const { error: manusUploadError } = await adminClient.storage
            .from("files")
            .upload(manusFileName, manuscriptFile, {
                contentType: manuscriptFile.type,
                upsert: false,
            });

        if (manusUploadError) {
            console.error("Manuscript upload error:", manusUploadError);
            return errorResponse("Failed to upload manuscript", 500);
        }

        const { data: manusUrlData } = adminClient.storage
            .from("files")
            .getPublicUrl(manusFileName);

        const manuscriptId = crypto.randomUUID();

        // Create Gallery Entry
        const galleryCoverImage = coverImageUrl
            ? { id: coverImageId || crypto.randomUUID(), url: coverImageUrl }
            : null;
        const galleryFiles = [{
            id: manuscriptId,
            url: manusUrlData.publicUrl,
        }];

        const { data: gallery, error: galleryError } = await adminClient
            .from("galleries")
            .insert({
                cover_image: galleryCoverImage,
                files: galleryFiles,
            })
            .select("id")
            .single();

        if (galleryError || !gallery) {
            console.error("Gallery creation error:", galleryError);
            return errorResponse("Failed to create gallery record", 500);
        }

        // Create Project Entry
        const studioId = formData.get("studio_id")?.toString() || null;

        // Create Project Entry
        const bookData = {
            title,
            author,
            description,
            isbn,
            publisher_name: publisherName,
            publication_date: publicationDate,
        };

        const { data: project, error: projectError } = await adminClient
            .from("projects")
            .insert({
                owner_id: user.id,
                organization_id: userData.organization_id,
                access_levels: [],
                book: bookData,
                gallery_id: gallery.id,
                genre_id: genreId,
                studio_id: studioId,
            })
            .select("*, gallery:galleries(*), genre:genres(*)")
            .single();

        if (projectError) {
            console.error("Project creation error:", projectError);
            return errorResponse("Failed to create project record", 500);
        }

        return successResponse({
            status: "success",
            message: "Project created successfully",
            project,
        }, 201);
    } catch (error) {
        console.error("Unexpected error:", error);
        return errorResponse("An unexpected error occurred", 500);
    }
});
