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
        const { studio_id, comment_id } = await req.json();

        // Validate request body
        if (!studio_id || !comment_id) {
            return new Response(
                JSON.stringify({
                    status: "error",
                    message:
                        "Missing required fields: studio_id and comment_id",
                }),
                { status: 400, headers: corsHeaders },
            );
        }

        // Create admin client for database operations
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const adminClient = createClient(supabaseUrl, supabaseServiceKey);

        // Fetch studio by studio_id
        const { data: studio, error: studioError } = await adminClient
            .from("studio")
            .select("comments")
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

        // Find and toggle the comment's resolved status
        const comments = Array.isArray(studio.comments) ? studio.comments : [];
        const commentIndex = comments.findIndex((c) => c.id === comment_id);

        if (commentIndex === -1) {
            return new Response(
                JSON.stringify({
                    status: "error",
                    message: "Comment not found",
                }),
                { status: 404, headers: corsHeaders },
            );
        }

        // Toggle the resolved status
        comments[commentIndex].resolved = !comments[commentIndex].resolved;
        const updatedComment = comments[commentIndex];

        // Update studio record
        const { error: updateError } = await adminClient
            .from("studio")
            .update({ comments: comments })
            .eq("id", studio_id);

        if (updateError) {
            console.error("Error updating studio:", updateError);
            return new Response(
                JSON.stringify({
                    status: "error",
                    message: "Failed to toggle comment resolution",
                }),
                { status: 500, headers: corsHeaders },
            );
        }

        // Return updated comment
        return new Response(
            JSON.stringify({
                status: "success",
                message: `Comment marked as ${
                    updatedComment.resolved ? "resolved" : "unresolved"
                }`,
                comment: updatedComment,
            }),
            { status: 200, headers: corsHeaders },
        );
    } catch (error) {
        console.error("Error in toggleCommentResolution:", error);
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
