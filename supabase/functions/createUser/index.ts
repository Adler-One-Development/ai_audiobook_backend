import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";
import { validatePassword } from "../_shared/password-validator.ts";

interface CreateUserRequest {
    email: string;
    full_name: string;
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
        const { email, full_name, role }: CreateUserRequest = await req.json();

        // Validate input
        if (!email || !full_name || !role) {
            return errorResponse(
                "Email, full_name, and role are required",
                400,
            );
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

        // Generate a secure random password (user won't see this)
        const securePassword = `${crypto.randomUUID()}${crypto.randomUUID()}`;

        // Create user in Supabase Auth
        const { data: authData, error: authCreateError } = await adminClient
            .auth.admin
            .createUser({
                email,
                password: securePassword,
                email_confirm: true, // Auto-confirm email
            });

        if (authCreateError) {
            console.error("Auth user creation error:", authCreateError);
            return errorResponse(authCreateError.message, 400);
        }

        if (!authData.user) {
            return errorResponse("Failed to create user", 500);
        }

        // Insert user record in users table
        const { data: userData, error: userCreateError } = await adminClient
            .from("users")
            .insert({
                id: authData.user.id,
                full_name: full_name,
                email: email,
                user_type: role,
                organization_id: requestingUser.organization_id,
                created_by: user!.id, // Track who created this user
            })
            .select("id, email, user_type, organization_id")
            .single();

        if (userCreateError || !userData) {
            console.error("User creation error:", userCreateError);
            // Cleanup: delete auth user if users table insert fails
            await adminClient.auth.admin.deleteUser(authData.user.id);
            return errorResponse("Failed to create user profile", 500);
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
                    "Failed to add user to organization:",
                    updateOrgError,
                );
            }
        }

        // Send password reset email
        const { error: resetError } = await adminClient.auth
            .resetPasswordForEmail(
                email,
                {
                    redirectTo: `${
                        req.headers.get("origin") || "https://yourdomain.com"
                    }/reset-password`,
                },
            );

        if (resetError) {
            console.error("Failed to send password reset email:", resetError);
            // Don't fail the user creation, just log the error
        }

        // Create response
        const response = {
            status: "success" as const,
            message: "User created successfully. Password reset email sent.",
            user: {
                id: userData.id,
                email: userData.email,
                userType: userData.user_type,
                organizationId: userData.organization_id,
            },
        };

        return successResponse(response, 201);
    } catch (error) {
        console.error("Create user error:", error);
        return errorResponse("An error occurred while creating user", 500);
    }
});
