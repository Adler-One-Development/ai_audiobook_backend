import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { createClient } from "../_shared/supabase-client.ts";
import { stripe } from "../_shared/stripe-helpers.ts";
import { getOrganization } from "../_shared/auth-helpers.ts";

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return handleCorsPreFlight();

    try {
        const supabaseClient = createClient(req);

        // Get Requesting User and Organization
        const { user, organization, error } = await getOrganization(
            req,
            supabaseClient,
        );
        if (error || !user || !organization) {
            return errorResponse(error || "Unauthorized", 401);
        }

        // Only ADMIN/OWNER can view billing history
        if (user.user_type !== "ADMIN" && user.user_type !== "OWNER") {
            return errorResponse("Only admins can view billing history", 403);
        }

        if (!organization.stripe_customer_id) {
            return successResponse({
                status: "success",
                message: "No billing history found",
                billing_history: [],
                processingTimeMs: 0,
            }, 200);
        }

        const startTime = Date.now();

        // List Charges from Stripe
        // Using limit: 100 for now, could add pagination params later
        const charges = await stripe.charges.list({
            customer: organization.stripe_customer_id,
            limit: 100,
        });

        const formattedHistory = charges.data.map((charge) => ({
            id: charge.id,
            amount: charge.amount / 100, // Convert cents to dollars
            currency: charge.currency,
            status: charge.status,
            created: charge.created,
            receipt_url: charge.receipt_url,
            description: charge.description,
            payment_method: charge.payment_method_details?.card?.brand
                ? `${charge.payment_method_details.card.brand} ending in ${charge.payment_method_details.card.last4}`
                : "Unknown",
        }));

        return successResponse({
            status: "success",
            message: "Billing history fetched successfully",
            billing_history: formattedHistory,
            processingTimeMs: Date.now() - startTime,
        }, 200);
    } catch (error: any) {
        console.error("getBillingHistory error:", error);
        return errorResponse(error.message, 500);
    }
});
