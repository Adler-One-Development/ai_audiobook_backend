import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (_req) => {
    try {
        // Ping the Stripe Webhook to keep it warm
        const webhookUrl =
            "https://hskaqvjruqzmgrwxmxxd.supabase.co/functions/v1/stripeWebhook";
        console.log(`Pinging ${webhookUrl}...`);

        const response = await fetch(webhookUrl);
        const text = await response.text();

        console.log(`Ping response status: ${response.status}`);
        console.log(`Ping response: ${text}`);

        return new Response(
            JSON.stringify({
                status: "success",
                target: webhookUrl,
                ping_status: response.status,
            }),
            {
                headers: { "Content-Type": "application/json" },
            },
        );
    } catch (error) {
        console.error("Ping failed:", error);
        return new Response(
            JSON.stringify({ status: "error", message: error.message }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            },
        );
    }
});
