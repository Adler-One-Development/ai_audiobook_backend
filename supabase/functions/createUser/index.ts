import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";

interface CreateUserRequest {
    emails: string[];
    role: "ADMIN" | "OWNER" | "MEMBER";
}

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        // Authenticate requesting user
        const { user, error: authError } = await getAuthenticatedUser(req);
        if (authError) return authError;

        // Parse request body
        const { emails, role }: CreateUserRequest = await req.json();

        // Validate input
        if (!emails || !Array.isArray(emails) || emails.length === 0) {
            return errorResponse(
                "emails must be a non-empty array",
                400,
            );
        }

        if (!role) {
            return errorResponse("role is required", 400);
        }

        if (!["ADMIN", "OWNER", "MEMBER"].includes(role)) {
            return errorResponse(
                "Invalid role. Must be ADMIN, OWNER, or MEMBER",
                400,
            );
        }

        const adminClient = createAdminClient();

        // Get requesting user's information
        const { data: requestingUser, error: userError } = await adminClient
            .from("users")
            .select("user_type, organization_id")
            .eq("id", user!.id)
            .single();

        if (userError || !requestingUser) {
            return errorResponse("Failed to get user information", 404);
        }

        // Check if user has an organization
        if (!requestingUser.organization_id) {
            return errorResponse(
                "You must be part of an organization to create users",
                403,
            );
        }

        // Get organization details
        const { data: org, error: orgError } = await adminClient
            .from("organizations")
            .select("owner_id")
            .eq("id", requestingUser.organization_id)
            .single();

        if (orgError || !org) {
            return errorResponse("Organization not found", 404);
        }

        // Authorization check: Only ADMIN and OWNER can create users
        if (
            requestingUser.user_type !== "ADMIN" &&
            requestingUser.user_type !== "OWNER"
        ) {
            return errorResponse("Only ADMIN and OWNER can create users", 403);
        }

        // Create users for each email
        const createdUsers = [];
        const failedUsers = [];

        for (const email of emails) {
            try {
                // Generate a secure random password (user won't see this)
                const securePassword =
                    `${crypto.randomUUID()}${crypto.randomUUID()}`;

                // Create user in Supabase Auth
                const { data: authData, error: authCreateError } =
                    await adminClient.auth.admin
                        .createUser({
                            email,
                            password: securePassword,
                            email_confirm: true, // Auto-confirm email
                        });

                if (authCreateError || !authData.user) {
                    console.error(
                        `Auth user creation error for ${email}:`,
                        authCreateError,
                    );
                    failedUsers.push({
                        email,
                        reason: authCreateError?.message ||
                            "Failed to create auth user",
                    });
                    continue;
                }

                // Insert user record in users table with empty full_name
                const { data: userData, error: userCreateError } =
                    await adminClient
                        .from("users")
                        .insert({
                            id: authData.user.id,
                            full_name: "", // User will set this when they set their password
                            email: email,
                            user_type: role,
                            organization_id: requestingUser.organization_id,
                            created_by: user!.id, // Track who created this user
                        })
                        .select("id, email, user_type, organization_id")
                        .single();

                if (userCreateError || !userData) {
                    console.error(
                        `User creation error for ${email}:`,
                        userCreateError,
                    );
                    // Cleanup: delete auth user if users table insert fails
                    await adminClient.auth.admin.deleteUser(authData.user.id);
                    failedUsers.push({
                        email,
                        reason: "Failed to create user profile",
                    });
                    continue;
                }

                // Add user to organization's member_ids if not OWNER
                if (role !== "OWNER") {
                    const { error: updateOrgError } = await adminClient.rpc(
                        "add_organization_member",
                        {
                            org_id: requestingUser.organization_id,
                            user_id: authData.user.id,
                        },
                    );

                    if (updateOrgError) {
                        console.error(
                            `Failed to add ${email} to organization:`,
                            updateOrgError,
                        );
                    }
                }

                // Send password reset email (acts as account setup email for new users)
                const { error: resetError } = await adminClient.auth
                    .resetPasswordForEmail(
                        email,
                        {
                            redirectTo: `${
                                req.headers.get("origin") ||
                                "https://yourdomain.com"
                            }/set-new-password`,
                        },
                    );

                if (resetError) {
                    console.error(
                        `Failed to send password reset email to ${email}:`,
                        resetError,
                    );
                    // Don't fail the user creation, just log the error
                }

                createdUsers.push({
                    id: userData.id,
                    email: userData.email,
                    userType: userData.user_type,
                    organizationId: userData.organization_id,
                });
            } catch (err) {
                console.error(`Error creating user ${email}:`, err);
                failedUsers.push({
                    email,
                    reason: "Unexpected error occurred",
                });
            }
        }

        // Create response
        const response = {
            status: "success" as const,
            message:
                `${createdUsers.length} user(s) created successfully. ${failedUsers.length} failed.`,
            users: createdUsers,
            failed: failedUsers.length > 0 ? failedUsers : undefined,
        };

        return successResponse(response, 201);
    } catch (error) {
        console.error("Create user error:", error);
        return errorResponse("An error occurred while creating user", 500);
    }
});
