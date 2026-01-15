import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        const { user_id, picture_url } = await req.json();

        if (!user_id || !picture_url) {
            return errorResponse("user_id and picture_url are required", 400);
        }

        const adminClient = createAdminClient();

        // Download the image from Google
        const imageResponse = await fetch(picture_url);
        if (!imageResponse.ok) {
            return errorResponse("Failed to download profile picture", 500);
        }

        const imageBlob = await imageResponse.blob();
        const imageBuffer = await imageBlob.arrayBuffer();

        // Generate filename
        const fileExtension = picture_url.includes(".jpg") ? "jpg" : "png";
        const fileName = `${crypto.randomUUID()}.${fileExtension}`;
        const storagePath = `${user_id}/${fileName}`;

        // Upload to Supabase storage
        const { error: uploadError } = await adminClient.storage
            .from("profile-pictures")
            .upload(storagePath, imageBuffer, {
                contentType: imageBlob.type || "image/jpeg",
                upsert: false,
            });

        if (uploadError) {
            console.error("Upload error:", uploadError);
            return errorResponse("Failed to upload profile picture", 500);
        }

        // Get public URL
        const { data: urlData } = adminClient.storage
            .from("profile-pictures")
            .getPublicUrl(storagePath);

        // Create profile_pictures record
        const { data: profilePicData, error: profilePicError } =
            await adminClient
                .from("profile_pictures")
                .insert({
                    url: urlData.publicUrl,
                })
                .select()
                .single();

        if (profilePicError) {
            console.error("Profile pic DB error:", profilePicError);
            // Clean up uploaded file
            await adminClient.storage.from("profile-pictures").remove([
                storagePath,
            ]);
            return errorResponse(
                "Failed to create profile picture record",
                500,
            );
        }

        // Update user with profile_picture_id
        const { error: updateError } = await adminClient
            .from("users")
            .update({ profile_picture_id: profilePicData.id })
            .eq("id", user_id);

        if (updateError) {
            console.error("User update error:", updateError);
            return errorResponse("Failed to update user profile", 500);
        }

        return successResponse({
            status: "success" as const,
            message: "Profile picture synced successfully",
            profile_picture: {
                id: profilePicData.id,
                url: profilePicData.url,
            },
        }, 200);
    } catch (error) {
        console.error("Sync profile picture error:", error);
        return errorResponse(
            "An error occurred while syncing profile picture",
            500,
        );
    }
});
