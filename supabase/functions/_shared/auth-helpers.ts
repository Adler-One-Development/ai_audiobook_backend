import { createClientFromRequest } from "./supabase-client.ts";
import { errorResponse } from "./response-helpers.ts";

/**
 * Extracts and validates the authenticated user from the request
 * Use this helper in protected endpoints to ensure users can only access their own data
 */
export async function getAuthenticatedUser(
    req: Request,
    options: { skipMfaCheck?: boolean } = {},
) {
    try {
        // Get the authorization header
        const authHeader = req.headers.get("Authorization");

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return {
                user: null,
                error: errorResponse(
                    "Unauthorized - Missing or invalid token",
                    401,
                ),
            };
        }

        // Create client with the user's token
        const supabase = createClientFromRequest(req);

        // Verify the token and get the user
        const { data: { user }, error } = await supabase.auth.getUser();

        if (error || !user) {
            return {
                user: null,
                error: errorResponse(
                    "Unauthorized - Invalid or expired token",
                    401,
                ),
            };
        }

        // Check for MFA requirements
        if (!options.skipMfaCheck) {
            const { createAdminClient } = await import("./supabase-client.ts");
            const adminClient = createAdminClient();

            // Check users table to see if MFA is enabled (Reliable Source of Truth)
            const { data: userData, error: userError } = await adminClient
                .from("users")
                .select("is_2fa_enabled")
                .eq("id", user.id)
                .single();

            if (userError) {
                console.error("Error fetching 2FA status:", userError);
                // If we can't read the user status, we should probably fail safe?
                // But strict failure might block valid users if DB has issues.
                // However, for MFA enforcement, fail-closed is safer.
                return {
                    user: null,
                    error: errorResponse(
                        "Unauthorized - Could not validate 2FA status",
                        401,
                    ),
                };
            }

            const isMfaEnabled = userData?.is_2fa_enabled === true;

            // Manually decode JWT to check AAL
            let currentAal = "aal1";
            try {
                const token = authHeader.replace("Bearer ", "");
                const base64Url = token.split(".")[1];
                const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
                const jsonPayload = decodeURIComponent(
                    atob(base64)
                        .split("")
                        .map((c) =>
                            "%" +
                            ("00" + c.charCodeAt(0).toString(16)).slice(-2)
                        )
                        .join(""),
                );
                const payload = JSON.parse(jsonPayload);
                currentAal = payload.aal || "aal1";
            } catch (e) {
                console.warn("Failed to decode JWT for AAL check", e);
            }

            // If MFA is enabled for the user, they MUST be at aal2
            if (isMfaEnabled && currentAal !== "aal2") {
                return {
                    user: null,
                    error: errorResponse(
                        "Unauthorized - MFA Verification Required",
                        403,
                    ),
                };
            }
        }

        return {
            user,
            error: null,
        };
    } catch (error) {
        console.error("Auth error:", error);
        return {
            user: null,
            error: errorResponse("Unauthorized - Authentication failed", 401),
        };
    }
}

/**
 * Validates that the authenticated user ID matches the requested user ID
 * Prevents users from accessing/modifying other users' data
 */
export function validateUserAccess(
    authenticatedUserId: string,
    requestedUserId: string,
): boolean {
    return authenticatedUserId === requestedUserId;
}

/**
 * Checks if the authenticated user has admin privileges
 * Returns true if user has ADMIN userType
 */
export async function isAdmin(userId: string): Promise<boolean> {
    try {
        const { createAdminClient } = await import("./supabase-client.ts");
        const adminClient = createAdminClient();

        const { data, error } = await adminClient
            .from("users")
            .select("user_type")
            .eq("id", userId)
            .single();

        if (error || !data) {
            return false;
        }

        return data.user_type === "ADMIN";
    } catch {
        return false;
    }
}

/**
 * Example usage for a protected endpoint:
 *
 * Deno.serve(async (req) => {
 *   // Get authenticated user
 *   const { user, error } = await getAuthenticatedUser(req);
 *   if (error) return error;
 *
 *   // Parse request
 *   const { userId, ...updateData } = await req.json();
 *
 *   // Validate user can only modify their own data
 *   if (!validateUserAccess(user!.id, userId)) {
 *     return errorResponse("Forbidden - Cannot modify other users' data", 403);
 *   }
 *
 *   // Proceed with update...
 * });

/**
 * Helper to get the authenticated user and their organization.
 * Used by payment functions to check permissions and get stripe_customer_id.
 */
export async function getOrganization(req: Request, supabaseClient: any) {
    // 1. Get User
    const { user, error: authError } = await getAuthenticatedUser(req);
    // If authError is present, it's a Response object, but we want to return a string error to the caller for consistency in this helper.
    // However, if user is null, it's definitely unauthorized.
    if (!user) {
        return {
            user: null,
            profile: null,
            organization: null,
            error: "Unauthorized: Invalid token or user not found",
        };
    }

    // 2. Get User Profile (for user_type)
    const { data: profile, error: profileError } = await supabaseClient
        .from("users")
        .select("*")
        .eq("id", user.id)
        .single();

    if (profileError) {
        return {
            user,
            profile: null,
            organization: null,
            error: `Failed to fetch profile: ${profileError.message}`,
        };
    }

    // 3. Get Organization (where user is owner OR member)
    const { data: organizations, error: orgError } = await supabaseClient
        .from("organizations")
        .select("*")
        .or(`owner_id.eq.${user.id},member_ids.cs.{${user.id}}`)
        .limit(1);

    if (orgError) {
        return {
            user,
            profile,
            organization: null,
            error: `Failed to fetch organization: ${orgError.message}`,
        };
    }

    if (!organizations || organizations.length === 0) {
        return { user, profile, organization: null, error: null };
    }

    return {
        user,
        profile,
        organization: organizations[0],
        error: null,
    };
}
