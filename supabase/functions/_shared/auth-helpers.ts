import { createClientFromRequest } from "./supabase-client.ts";
import { errorResponse } from "./response-helpers.ts";

/**
 * Extracts and validates the authenticated user from the request
 * Use this helper in protected endpoints to ensure users can only access their own data
 */
export async function getAuthenticatedUser(req: Request) {
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
 */
