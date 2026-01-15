import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import {
    createAdminClient,
    createAuthClient,
} from "../_shared/supabase-client.ts";
import type { LoginRequest, LoginResponse, User } from "../_shared/types.ts";

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        // Parse request body
        const { email, password }: LoginRequest = await req.json();

        // Validate input
        if (!email || !password) {
            return errorResponse("Email and password are required", 400);
        }

        // Authenticate user with Supabase Auth
        const authClient = createAuthClient();
        const { data: authData, error: authError } = await authClient.auth
            .signInWithPassword({
                email,
                password,
            });

        if (authError || !authData.user || !authData.session) {
            return errorResponse("Invalid email or password", 401);
        }

        // Fetch user details from users table
        const adminClient = createAdminClient();
        const { data: userData, error: userError } = await adminClient
            .from("users")
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
        industries (id, industry_name),
        profile_picture_id,
        profile_pictures(id, url),
        is_2fa_enabled
      `,
            )
            .eq("id", authData.user.id)
            .single();

        if (userError || !userData) {
            return errorResponse("User data not found", 404);
        }

        // Format user data
        const industry = Array.isArray(userData.industries) ? userData.industries[0] : userData.industries;
        const profilePicture = Array.isArray(userData.profile_pictures) ? userData.profile_pictures[0] : userData.profile_pictures;

        const user: User = {
            id: userData.id,
            fullName: userData.full_name,
            email: userData.email,
            phone: userData.phone,
            publisherName: userData.publisher_name,
            userType: userData.user_type,
            role: userData.role,
            industry: industry
                ? {
                    id: industry.id,
                    industryName: industry.industry_name,
                }
                : null,
            profilePicture: profilePicture
                ? {
                    id: profilePicture.id,
                    url: profilePicture.url,
                }
                : null,
            is2FAEnabled: userData.is_2fa_enabled || false,
        };

        const is2FAEnabled = userData.is_2fa_enabled || false;

        // Create response
        const response: LoginResponse = {
            status: "success",
            message: is2FAEnabled ? "MFA verification required" : "Login successful",
            token: authData.session.access_token,
            refreshToken: authData.session.refresh_token,
            expiresIn: authData.session.expires_in || 3600,
            userType: userData.user_type,
            user,
            mfaRequired: is2FAEnabled,
        };

        return successResponse(response, 200);
    } catch (error) {
        console.error("Login error:", error);
        return errorResponse("An error occurred during login", 500);
    }
});
