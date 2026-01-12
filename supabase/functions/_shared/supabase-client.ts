import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Get Supabase URL and keys from environment
 */
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Creates a Supabase client with the anon key
 * Used for auth operations
 */
export function createAuthClient() {
    return createClient(supabaseUrl, supabaseAnonKey);
}

/**
 * Creates a Supabase client with the service role key
 * Used for admin operations (bypasses RLS)
 */
export function createAdminClient() {
    return createClient(supabaseUrl, supabaseServiceRoleKey);
}

/**
 * Creates a Supabase client from the request authorization header
 * Used for authenticated operations
 */
export function createClientFromRequest(req: Request) {
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");

    return createClient(supabaseUrl, supabaseAnonKey, {
        global: {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
    });
}
