import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req) => {
    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers":
                    "authorization, x-client-info, apikey, content-type",
            },
        });
    }

    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
            "authorization, x-client-info, apikey, content-type",
        "Content-Type": "application/json",
    };

    try {
        // Get the authorization header
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: "Missing authorization header" }),
                { status: 401, headers: corsHeaders },
            );
        }

        // Initialize Supabase client
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
        const supabaseClient = createClient(supabaseUrl, supabaseKey, {
            global: {
                headers: { Authorization: authHeader },
            },
        });

        // Get the authenticated user
        const {
            data: { user },
            error: userError,
        } = await supabaseClient.auth.getUser();

        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: "Unauthorized" }),
                { status: 401, headers: corsHeaders },
            );
        }

        // Parse request body
        const { studio_id, block_id, text } = await req.json();

        // Validate request body
        if (!studio_id || !block_id || !text) {
            return new Response(
                JSON.stringify({
                    status: "error",
                    message:
                        "Missing required fields: studio_id, block_id, text",
                }),
                { status: 400, headers: corsHeaders },
            );
        }

        if (typeof text !== "string" || text.trim().length === 0) {
            return new Response(
                JSON.stringify({
                    status: "error",
                    message: "Comment text cannot be empty",
                }),
                { status: 400, headers: corsHeaders },
            );
        }

        // Create admin client for database operations
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const adminClient = createClient(supabaseUrl, supabaseServiceKey);

        // Get user details from users table
        const { data: userData, error: userDataError } = await adminClient
            .from("users")
            .select("full_name")
            .eq("id", user.id)
            .single();

        if (userDataError) {
            console.error("Error fetching user data:", userDataError);
            return new Response(
                JSON.stringify({
                    status: "error",
                    message: "Failed to fetch user details",
                }),
                { status: 500, headers: corsHeaders },
            );
        }

        // Fetch studio by studio_id
        const { data: studio, error: studioError } = await adminClient
            .from("studio")
            .select("id, chapters, comments")
            .eq("id", studio_id)
            .single();

        if (studioError || !studio) {
            return new Response(
                JSON.stringify({
                    status: "error",
                    message: "Studio not found",
                }),
                { status: 404, headers: corsHeaders },
            );
        }

        // Validate block_id exists in studio chapters
        let blockExists = false;
        if (Array.isArray(studio.chapters)) {
            for (const chapter of studio.chapters) {
                if (chapter.content_json?.blocks) {
                    for (const block of chapter.content_json.blocks) {
                        if (block.block_id === block_id) {
                            blockExists = true;
                            break;
                        }
                    }
                    if (blockExists) break;
                }
            }
        }

        if (!blockExists) {
            return new Response(
                JSON.stringify({
                    status: "error",
                    message:
                        `Block ID '${block_id}' not found in studio chapters`,
                }),
                { status: 400, headers: corsHeaders },
            );
        }

        // Create comment object
        const comment = {
            id: crypto.randomUUID(),
            user_id: user.id,
            user_name: userData.full_name || user.email || "Unknown User",
            text: text.trim(),
            timestamp: new Date().toISOString(),
            block_id: block_id,
            resolved: false,
        };

        // Append comment to studio.comments array
        const currentComments = Array.isArray(studio.comments)
            ? studio.comments
            : [];
        const updatedComments = [...currentComments, comment];

        // Update studio record
        const { error: updateError } = await adminClient
            .from("studio")
            .update({ comments: updatedComments })
            .eq("id", studio_id);

        if (updateError) {
            console.error("Error updating studio:", updateError);
            return new Response(
                JSON.stringify({
                    status: "error",
                    message: "Failed to create comment",
                }),
                { status: 500, headers: corsHeaders },
            );
        }

        // Return created comment
        return new Response(
            JSON.stringify({
                status: "success",
                message: "Comment created successfully",
                comment: comment,
            }),
            { status: 201, headers: corsHeaders },
        );
    } catch (error) {
        console.error("Error in createComment:", error);
        return new Response(
            JSON.stringify({
                status: "error",
                message: error instanceof Error
                    ? error.message
                    : "Unknown error",
            }),
            { status: 500, headers: corsHeaders },
        );
    }
});
