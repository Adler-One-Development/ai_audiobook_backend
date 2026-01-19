import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";

interface FlushDatabaseRequest {
    password: string;
}

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        // Parse request body
        const { password }: FlushDatabaseRequest = await req.json();

        // Validate password
        const ADMIN_PASSWORD = Deno.env.get("FLUSH_DB_PASSWORD") || "admin123@";

        if (!password || password !== ADMIN_PASSWORD) {
            return errorResponse("Invalid admin password", 403);
        }

        const adminClient = createAdminClient();

        console.log("⚠️ FLUSH DATABASE OPERATION STARTED");

        // Delete all users from auth.users (Supabase Auth)
        const { data: authUsers, error: listError } = await adminClient.auth
            .admin.listUsers();

        if (listError) {
            console.error("Failed to list auth users:", listError);
        } else if (authUsers?.users) {
            console.log(`Deleting ${authUsers.users.length} auth users...`);
            for (const user of authUsers.users) {
                await adminClient.auth.admin.deleteUser(user.id);
            }
        }

        // Clear profile_pictures storage bucket
        try {
            const { data: files, error: listFilesError } = await adminClient
                .storage
                .from("profile_pictures")
                .list();

            if (!listFilesError && files) {
                console.log(
                    `Deleting ${files.length} files from profile_pictures bucket...`,
                );
                const filePaths = files.map((file) => file.name);
                if (filePaths.length > 0) {
                    await adminClient.storage
                        .from("profile_pictures")
                        .remove(filePaths);
                }
            }
        } catch (storageError) {
            console.error(
                "Profile pictures bucket cleanup error:",
                storageError,
            );
            // Continue even if storage fails
        }

        // Delete from database tables in order (respecting foreign key constraints)
        const tablesToFlush = [
            "profile_pictures",
            "copyrights",
            "users",
            "organizations",
            "industries",
        ];

        for (const table of tablesToFlush) {
            const { error: deleteError } = await adminClient
                .from(table)
                .delete()
                .neq("id", "00000000-0000-0000-0000-000000000000"); // Delete all rows

            if (deleteError) {
                console.error(`Failed to flush ${table}:`, deleteError);
            } else {
                console.log(`✓ Flushed table: ${table}`);
            }
        }

        console.log("✓ FLUSH DATABASE OPERATION COMPLETED");

        const response = {
            status: "success" as const,
            message:
                "Database flushed successfully. All user data, organizations, and related data have been deleted.",
        };

        return successResponse(response, 200);
    } catch (error) {
        console.error("Flush database error:", error);
        return errorResponse(
            "An error occurred while flushing database",
            500,
        );
    }
});
