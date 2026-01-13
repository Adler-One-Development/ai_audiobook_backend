import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { validatePassword } from "../_shared/password-validator.ts";
import {
    createAdminClient,
    createAuthClient,
} from "../_shared/supabase-client.ts";
import type { SignUpRequest, SignUpResponse, User } from "../_shared/types.ts";

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        // Parse request body
        const { email, password, fullName }: SignUpRequest = await req.json();

        // Validate input
        if (!email || !password || !fullName) {
            return errorResponse(
                "Email, password, and full name are required",
                400,
            );
        }

        // Validate password strength
        const passwordValidation = validatePassword(password);
        if (!passwordValidation.isValid) {
            return errorResponse(
                "Password does not meet requirements",
                400,
                passwordValidation.errors,
            );
        }

        // Create user in Supabase Auth
        const authClient = createAuthClient();
        const { data: authData, error: authError } = await authClient.auth
            .signUp({
                email,
                password,
            });

        if (authError) {
            return errorResponse(authError.message, 400);
        }

        if (!authData.user) {
            return errorResponse("Failed to create user", 500);
        }

        // Insert user record in users table with default userType = ADMIN
        const adminClient = createAdminClient();
        const { data: userData, error: userError } = await adminClient
            .from("users")
            .insert({
                id: authData.user.id,
                full_name: fullName,
                email: email,
                user_type: "ADMIN", // Default user type
            })
            .select(
                `
        id,
        full_name,
        email,
        phone,
        publisher_name,
        user_type,
        role,
        industry_id,
        profile_picture_id
      `,
            )
            .single();

        if (userError || !userData) {
            // If user creation in users table fails, we should ideally delete the auth user
            // For now, return error
            console.error("User creation error:", userError);
            return errorResponse("Failed to create user profile", 500);
        }

        // Format user data
        const user: User = {
            id: userData.id,
            fullName: userData.full_name,
            email: userData.email,
            phone: userData.phone,
            publisherName: userData.publisher_name,
            userType: userData.user_type,
            role: userData.role,
            industry: null,
            profilePicture: null, // No profile picture on signup
        };

        // Create response
        const response: SignUpResponse = {
            status: "success",
            message: "User created successfully",
            user,
        };

        return successResponse(response, 201);
    } catch (error) {
        console.error("SignUp error:", error);
        return errorResponse("An error occurred during signup", 500);
    }
});
