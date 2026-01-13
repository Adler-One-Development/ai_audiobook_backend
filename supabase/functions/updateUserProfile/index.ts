import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";

interface UpdateProfileRequest {
    full_name?: string;
    phone?: string;
    publisher_name?: string;
    role?: string;
    industry_id?: string;
    profile_picture?: string; // Base64 encoded image or file data
}

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        // Authenticate user
        const { user, error: authError } = await getAuthenticatedUser(req);
        if (authError) return authError;

        // Parse request body (multipart form data or JSON)
        const contentType = req.headers.get("content-type") || "";
        let updateData: UpdateProfileRequest = {};
        let profilePictureFile: File | null = null;

        if (contentType.includes("multipart/form-data")) {
            // Handle form data (for file uploads)
            const formData = await req.formData();

            updateData = {
                full_name: formData.get("full_name")?.toString(),
                phone: formData.get("phone")?.toString(),
                publisher_name: formData.get("publisher_name")?.toString(),
                role: formData.get("role")?.toString(),
                industry_id: formData.get("industry_id")?.toString(),
            };

            const file = formData.get("profile_picture");
            if (file && file instanceof File) {
                profilePictureFile = file;
            }
        } else {
            // Handle JSON
            updateData = await req.json();
        }

        const adminClient = createAdminClient();

        // Handle profile picture upload if provided
        let newProfilePictureId: string | null = null;

        if (profilePictureFile) {
            // Validate file size (2MB limit)
            const maxSizeInBytes = 2 * 1024 * 1024; // 2MB
            if (profilePictureFile.size > maxSizeInBytes) {
                return errorResponse(
                    "Profile picture size must be less than 2MB",
                    400,
                );
            }

            // Validate file type (only images allowed)
            const allowedTypes = [
                "image/jpeg",
                "image/jpg",
                "image/png",
                "image/gif",
                "image/webp",
            ];
            if (!allowedTypes.includes(profilePictureFile.type)) {
                return errorResponse(
                    "Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed",
                    400,
                );
            }
            // Get user's current profile picture
            const { data: userData } = await adminClient
                .from("users")
                .select("profile_picture_id, profile_pictures(id, url)")
                .eq("id", user!.id)
                .single();

            // Delete old profile picture if exists
            if (userData?.profile_picture_id) {
                // Extract storage path from URL
                const oldPicture = userData.profile_pictures as any;
                if (oldPicture && oldPicture.url) {
                    const urlParts = oldPicture.url.split("/");
                    const storagePath = urlParts.slice(-2).join("/"); // Get user_id/filename

                    // Delete from storage
                    await adminClient.storage
                        .from("profile-pictures")
                        .remove([storagePath]);
                }

                // Delete from profile_pictures table
                await adminClient
                    .from("profile_pictures")
                    .delete()
                    .eq("id", userData.profile_picture_id);
            }

            // Upload new profile picture to storage
            const fileExt = profilePictureFile.name.split(".").pop();
            const fileName = `${user!.id}/${crypto.randomUUID()}.${fileExt}`;

            const { data: uploadData, error: uploadError } = await adminClient
                .storage
                .from("profile-pictures")
                .upload(fileName, profilePictureFile, {
                    contentType: profilePictureFile.type,
                    upsert: false,
                });

            if (uploadError) {
                console.error("Upload error:", uploadError);
                return errorResponse("Failed to upload profile picture", 500);
            }

            // Get public URL
            const { data: { publicUrl } } = adminClient.storage
                .from("profile-pictures")
                .getPublicUrl(fileName);

            // Insert into profile_pictures table
            const { data: pictureData, error: pictureError } = await adminClient
                .from("profile_pictures")
                .insert({ url: publicUrl })
                .select("id")
                .single();

            if (pictureError || !pictureData) {
                console.error("Picture insert error:", pictureError);
                return errorResponse("Failed to save profile picture", 500);
            }

            newProfilePictureId = pictureData.id;
        }

        // Prepare update object (only include fields that were provided)
        const updateFields: any = {};
        if (updateData.full_name !== undefined) {
            updateFields.full_name = updateData.full_name;
        }
        if (updateData.phone !== undefined) {
            updateFields.phone = updateData.phone;
        }
        if (updateData.publisher_name !== undefined) {
            updateFields.publisher_name = updateData.publisher_name;
        }
        if (updateData.role !== undefined) updateFields.role = updateData.role;
        if (updateData.industry_id !== undefined) {
            updateFields.industry_id = updateData.industry_id;
        }
        if (newProfilePictureId) {
            updateFields.profile_picture_id = newProfilePictureId;
        }

        // Update user profile
        const { data: updatedUser, error: updateError } = await adminClient
            .from("users")
            .update(updateFields)
            .eq("id", user!.id)
            .select(`
        id,
        full_name,
        email,
        phone,
        publisher_name,
        role,
        industry_id,
        industries (
          id,
          industry_name
        ),
        profile_picture_id,
        profile_pictures (
          id,
          url
        )
      `)
            .single();

        if (updateError || !updatedUser) {
            console.error("Update error:", updateError);
            return errorResponse("Failed to update profile", 500);
        }

        // Format response
        const profile = {
            full_name: updatedUser.full_name,
            email: updatedUser.email,
            phone: updatedUser.phone,
            publisher_name: updatedUser.publisher_name,
            role: updatedUser.role,
            industry: updatedUser.industries || null,
            profile_picture: updatedUser.profile_pictures || null,
        };

        return successResponse(
            {
                status: "success" as const,
                message: "Profile updated successfully",
                profile,
            },
            200,
        );
    } catch (error) {
        console.error("Update profile error:", error);
        return errorResponse("An error occurred while updating profile", 500);
    }
});
