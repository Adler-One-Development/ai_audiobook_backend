import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  errorResponse,
  handleCorsPreFlight,
  successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser, isAdmin } from "../_shared/auth-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight();
  }

  try {
    const { user, error: authError } = await getAuthenticatedUser(req);
    if (authError) return authError;

    const { profile_picture_id } = await req.json();

    if (!profile_picture_id) {
      return errorResponse("profile_picture_id is required", 400);
    }

    const adminClient = createAdminClient();

    // 1. Check ownership and get URL
    const { data: userData, error: userError } = await adminClient
      .from("users")
      .select("profile_picture_id, user_type")
      .eq("id", user!.id)
      .single();

    if (userError) return errorResponse("Failed to fetch user data", 500);

    const isOwner = userData.profile_picture_id === profile_picture_id;
    const isUserAdmin = userData.user_type === "ADMIN" ||
      userData.user_type === "OWNER";

    if (!isOwner && !isUserAdmin) {
      return errorResponse(
        "Unauthorized: You can only delete your own profile picture",
        403,
      );
    }

    // 2. Get the picture record to find the storage URL
    const { data: pictureData, error: pictureFetchError } = await adminClient
      .from("profile_pictures")
      .select("url")
      .eq("id", profile_picture_id)
      .single();

    if (pictureFetchError || !pictureData) {
      return errorResponse("Profile picture not found", 404);
    }

    // 3. Delete from Storage
    if (pictureData.url) {
      const urlParts = pictureData.url.split("/");
      // Assuming path format: .../profile-pictures/user_id/filename
      const storagePath = urlParts.slice(-2).join("/");

      const { error: storageError } = await adminClient.storage
        .from("profile-pictures")
        .remove([storagePath]);

      if (storageError) {
        console.error("Storage delete error:", storageError);
        // Proceed anyway to clear DB references
      }
    }

    // 4. Update users table (set to NULL)
    // If we are admin deleting someone else's, we should find WHO has this picture.
    // But typically 1:1.
    // Let's update any user who references this ID to null.
    const { error: updateError } = await adminClient
      .from("users")
      .update({ profile_picture_id: null })
      .eq("profile_picture_id", profile_picture_id);

    if (updateError) {
      console.error("User update error:", updateError);
      return errorResponse("Failed to unlink profile picture", 500);
    }

    // 5. Delete from profile_pictures table
    const { error: deleteError } = await adminClient
      .from("profile_pictures")
      .delete()
      .eq("id", profile_picture_id);

    if (deleteError) {
      return errorResponse("Failed to delete profile picture record", 500);
    }

    return successResponse({
      status: "success",
      message: "Profile picture removed successfully",
    }, 200);
  } catch (error) {
    console.error("Remove profile picture error:", error);
    return errorResponse("An error occurred", 500);
  }
});
