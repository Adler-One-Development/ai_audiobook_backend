import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        // Authenticate user
        const { user, error: authError } = await getAuthenticatedUser(req);
        if (authError) return authError;

        const adminClient = createAdminClient();

        // Get user's data
        const { data: userData, error: userError } = await adminClient
            .from("users")
            .select(
                "profile_picture_id, organization_id, profile_pictures(id, url)",
            )
            .eq("id", user!.id)
            .single();

        if (userError) {
            console.error("Failed to get user data:", userError);
            return errorResponse("Failed to get user information", 404);
        }

        // Delete profile picture if exists
        if (userData?.profile_picture_id && userData.profile_pictures) {
            const profilePic = userData.profile_pictures as any;

            // Extract storage path from URL
            if (profilePic && profilePic.url) {
                const urlParts = profilePic.url.split("/");
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

        // Delete organization if user has one
        if (userData?.organization_id) {
            const { error: orgDeleteError } = await adminClient
                .from("organizations")
                .delete()
                .eq("id", userData.organization_id);

            if (orgDeleteError) {
                console.error("Failed to delete organization:", orgDeleteError);
                // Continue anyway, we'll delete the user
            }
        }

        // Delete user from users table
        const { error: deleteUserError } = await adminClient
            .from("users")
            .delete()
            .eq("id", user!.id);

        if (deleteUserError) {
            console.error("User deletion error:", deleteUserError);
            return errorResponse("Failed to delete user profile", 500);
        }

        // Delete user from auth
        const { error: deleteAuthError } = await adminClient.auth.admin
            .deleteUser(user!.id);

        if (deleteAuthError) {
            console.error("Auth deletion error:", deleteAuthError);
            return errorResponse("Failed to delete user authentication", 500);
        }

        // Create response
        const response = {
            status: "success" as const,
            message: "Account deleted successfully",
        };

        return successResponse(response, 200);
    } catch (error) {
        console.error("Delete account error:", error);
        return errorResponse("An error occurred while deleting account", 500);
    }
});
