import "jsr:@supabase/functions-js@2/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { type CopyrightsSetResponse } from "../_shared/types.ts";
import { getAuthenticatedUser } from "../_shared/auth-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return handleCorsPreFlight();
    }

    try {
        // Parse request body
        const { organization_id, copyrights_text } = await req.json();

        if (!organization_id) {
            return errorResponse("Organization ID is required", 400);
        }

        if (copyrights_text === undefined) {
             return errorResponse("Copyrights text is required", 400);
        }

        // Authenticate user
        const { error: authError } = await getAuthenticatedUser(req);
        if (authError) return authError;

        const adminClient = createAdminClient();
        
        // Check if copyrights exist already
        const { data: existingCopyright, error: fetchError } = await adminClient
            .from("copyrights")
            .select("id")
            .eq("organization_id", organization_id)
            .single();

        if (fetchError && fetchError.code !== "PGRST116") {
             console.error("Error fetching existing copyright:", fetchError);
             return errorResponse("Failed to check existing copyrights", 500);
        }

        let result;
        if (existingCopyright) {
            // Update
            const { data, error } = await adminClient
                .from("copyrights")
                .update({ 
                    copyrights_text,
                    updated_at: new Date().toISOString()
                })
                .eq("organization_id", organization_id)
                .select()
                .single();
            
            if (error) throw error;
            result = data;
        } else {
            // Create
            const { data, error } = await adminClient
                .from("copyrights")
                .insert({
                    organization_id,
                    copyrights_text,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .select()
                .single();
            
             if (error) throw error;
             result = data;
        }

        return successResponse<CopyrightsSetResponse>({
            status: "success",
            message: existingCopyright ? "Copyright updated successfully" : "Copyright created successfully",
            data: {
                copyrights_text: result.copyrights_text,
                created_at: result.created_at,
                updated_at: result.updated_at,
            },
        }, 200);

    } catch (error) {
        console.error("Set organization copyright error:", error);
        return errorResponse(
            "An error occurred while setting organization copyright",
            500,
        );
    }
});
