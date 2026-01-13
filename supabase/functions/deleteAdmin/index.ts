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
            .select("organization_id")
            .eq("id", user!.id)
            .single();

        if (userError) {
            console.error("Failed to get user data:", userError);
            return errorResponse("Failed to get user information", 404);
        }

        // Get all users in the organization
        const { data: orgUsers, error: orgUsersError } = await adminClient
            .from("users")
            .select("id, profile_picture_id, profile_pictures(id, url)")
            .eq("organization_id", userData.organization_id);

        if (orgUsersError) {
            console.error("Failed to get organization users:", orgUsersError);
        }

        // Delete all users' profile pictures and auth accounts
        if (orgUsers && orgUsers.length > 0) {
            for (const orgUser of orgUsers) {
                // Delete profile picture if exists
                if (orgUser.profile_picture_id && orgUser.profile_pictures) {
                    const profilePic = orgUser.profile_pictures as any;

                    if (profilePic && profilePic.url) {
                        const urlParts = profilePic.url.split("/");
                        const storagePath = urlParts.slice(-2).join("/");

                        await adminClient.storage
                            .from("profile-pictures")
                            .remove([storagePath]);
                    }

                    await adminClient
                        .from("profile_pictures")
                        .delete()
                        .eq("id", orgUser.profile_picture_id);
                }

                // Delete user from users table
                await adminClient
                    .from("users")
                    .delete()
                    .eq("id", orgUser.id);

                // Delete user from auth
                await adminClient.auth.admin.deleteUser(orgUser.id);
            }
        }

        // Delete organization
        if (userData?.organization_id) {
            await adminClient
                .from("organizations")
                .delete()
                .eq("id", userData.organization_id);
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
