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

        // Get user's organization_id
        const { data: userData, error: userError } = await adminClient
            .from("users")
            .select("organization_id")
            .eq("id", user!.id)
            .single();

        if (userError || !userData) {
            return errorResponse("User not found", 404);
        }

        if (!userData.organization_id) {
            return errorResponse("User is not part of any organization", 404);
        }

        // Get organization details to find owner
        const { data: organization, error: orgError } = await adminClient
            .from("organizations")
            .select("owner_id")
            .eq("id", userData.organization_id)
            .single();

        if (orgError || !organization) {
            return errorResponse("Organization not found", 404);
        }

        // Fetch all users in this organization with creator info
        const { data: members, error: membersError } = await adminClient
            .from("users")
            .select(`
        id,
        full_name,
        email,
        phone,
        publisher_name,
        user_type,
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
        ),
        created_at,
        created_by,
        is_active,
        creator:created_by (
          id,
          full_name,
          email,
          profile_picture_id,
          profile_pictures (
            id,
            url
          )
        )
      `)
            .eq("organization_id", userData.organization_id);

        if (membersError) {
            console.error("Failed to fetch members:", membersError);
            return errorResponse("Failed to fetch organization members", 500);
        }

        // Fetch last sign-in info for all members from auth.users
        const memberIds = (members || []).map((m: any) => m.id);
        const { data: authUsers, error: authDataError } = await adminClient.auth
            .admin
            .listUsers();

        if (authDataError) {
            console.error("Failed to fetch auth data:", authDataError);
        }

        // Create maps for user_id -> last_sign_in_at and user_id -> created_at
        const lastSignInMap = new Map();
        const createdAtMap = new Map();
        if (authUsers?.users) {
            authUsers.users.forEach((authUser: any) => {
                if (memberIds.includes(authUser.id)) {
                    lastSignInMap.set(authUser.id, authUser.last_sign_in_at);
                    createdAtMap.set(authUser.id, authUser.created_at);
                }
            });
        }

        // Format the response
        const formattedMembers = (members || []).map((member: any) => {
            const lastActive = lastSignInMap.get(member.id) || null;
            const createdAt = new Date(member.created_at);
            const now = new Date();
            const hoursSinceCreation = (now.getTime() - createdAt.getTime()) /
                (1000 * 60 * 60);

            // Calculate status based on is_active, lastActive, and invite age
            let status: "Active" | "Invited" | "Expired" | "Inactive";
            if (member.is_active === false) {
                status = "Inactive";
            } else if (lastActive !== null) {
                status = "Active";
            } else if (hoursSinceCreation > 1) {
                // Password reset link expires after 1 hour (Supabase default)
                status = "Expired";
            } else {
                status = "Invited";
            }

            return {
                id: member.id,
                fullName: member.full_name,
                email: member.email,
                phone: member.phone,
                publisherName: member.publisher_name,
                userType: member.user_type,
                role: member.role,
                industry: member.industries
                    ? {
                        id: member.industries.id,
                        industryName: member.industries.industry_name,
                    }
                    : null,
                profilePicture: member.profile_pictures
                    ? {
                        id: member.profile_pictures.id,
                        url: member.profile_pictures.url,
                    }
                    : null,
                isOwner: member.id === organization.owner_id,
                createdAt: member.created_at,
                createdBy: member.creator
                    ? {
                        id: member.creator.id,
                        name: member.creator.full_name,
                        email: member.creator.email,
                        profilePicture: member.creator.profile_pictures
                            ? {
                                id: member.creator.profile_pictures.id,
                                url: member.creator.profile_pictures.url,
                            }
                            : null,
                    }
                    : null,
                lastActive: lastActive,
                addedOn: createdAtMap.get(member.id) || null,
                status: status,
            };
        });

        // Create response
        const response = {
            status: "success" as const,
            message: "Organization members fetched successfully",
            members: formattedMembers,
            totalMembers: formattedMembers.length,
        };

        return successResponse(response, 200);
    } catch (error) {
        console.error("Get organization members error:", error);
        return errorResponse(
            "An error occurred while fetching organization members",
            500,
        );
    }
});
