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
        const { studio_id, block_id, chapter_id, text, quote, range } =
            await req.json();

        // Validate request body
        if (!studio_id || !text) {
            return new Response(
                JSON.stringify({
                    status: "error",
                    message: "Missing required fields: studio_id, text",
                }),
                { status: 400, headers: corsHeaders },
            );
        }

        // Must have either block_id OR chapter_id
        if (!block_id && !chapter_id) {
            return new Response(
                JSON.stringify({
                    status: "error",
                    message: "Must provide either block_id or chapter_id",
                }),
                { status: 400, headers: corsHeaders },
            );
        }

        // Validation for word-level comments
        if ((quote || range) && !block_id) {
            return new Response(
                JSON.stringify({
                    status: "error",
                    message:
                        "Word-level comments (quote/range) require block_id",
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

        // Context Validation
        let contextExists = false;
        if (Array.isArray(studio.chapters)) {
            if (chapter_id && !block_id) {
                // Validate Chapter Exists
                contextExists = studio.chapters.some((ch: any) =>
                    ch.id === chapter_id
                );
            } else if (block_id) {
                // Validate Block Exists
                for (const chapter of studio.chapters) {
                    if (chapter.content_json?.blocks) {
                        if (
                            chapter.content_json.blocks.some((b: any) =>
                                b.block_id === block_id
                            )
                        ) {
                            contextExists = true;
                            break;
                        }
                    }
                }
            }
        }

        if (!contextExists) {
            const errorMsg = chapter_id && !block_id
                ? `Chapter ID '${chapter_id}' not found`
                : `Block ID '${block_id}' not found`;

            return new Response(
                JSON.stringify({
                    status: "error",
                    message: errorMsg,
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
            resolved: false,
            // Conditional fields
            ...(block_id && { block_id }),
            ...(chapter_id && { chapter_id }),
            ...(quote && { quote }),
            ...(range && { range }),
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
