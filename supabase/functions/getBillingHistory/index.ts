import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { createClientFromRequest } from "../_shared/supabase-client.ts";
import { stripe } from "../_shared/stripe-helpers.ts";
import { getOrganization } from "../_shared/auth-helpers.ts";

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return handleCorsPreFlight();

    try {
        const supabaseClient = createClientFromRequest(req);
        const { starting_after, limit } = await req.json().catch(() => ({}));

        // Get Requesting User and Organization
        const { user, profile, organization, error } = await getOrganization(
            req,
            supabaseClient,
        );
        if (error || !user || !organization) {
            return errorResponse(error || "Unauthorized", 401);
        }

        // Only ADMIN/OWNER can view billing history
        if (profile?.user_type !== "ADMIN" && profile?.user_type !== "OWNER") {
            return errorResponse("Only admins can view billing history", 403);
        }

        const startTime = Date.now();

        if (!organization.stripe_customer_id) {
            return successResponse({
                status: "success",
                message: "No billing account configured",
                transactions: [],
                has_more: false,
                processingTimeMs: Date.now() - startTime,
            }, 200);
        }

        // List Charges from Stripe
        const params: any = {
            customer: organization.stripe_customer_id,
            limit: limit || 10,
        };
        if (starting_after) {
            params.starting_after = starting_after;
        }

        const charges = await stripe.charges.list(params);

        const formattedTransactions = charges.data.map((charge) => ({
            id: charge.id,
            amount: charge.amount / 100, // Convert cents to dollars
            currency: charge.currency,
            status: charge.status, // "succeeded", "pending", "failed"
            description: charge.description,
            created: new Date(charge.created * 1000).toISOString(), // Convert Unix timestamp to ISO
            receipt_url: charge.receipt_url,
            payment_method: {
                brand: charge.payment_method_details?.card?.brand || "unknown",
                last4: charge.payment_method_details?.card?.last4 || "0000",
            },
            refunded: charge.refunded,
            amount_refunded: charge.amount_refunded / 100,
            price_per_credit: charge.metadata?.price_per_credit
                ? Number(charge.metadata.price_per_credit)
                : null,
            total_credits_purchased: charge.metadata?.credits
                ? Number(charge.metadata.credits)
                : null,
            total_amount_spent: charge.amount / 100,
        }));

        return successResponse({
            status: "success",
            message: "Billing history retrieved successfully",
            transactions: formattedTransactions,
            has_more: charges.has_more,
            processingTimeMs: Date.now() - startTime,
        }, 200);
    } catch (error: any) {
        console.error("getBillingHistory error:", error);
        return errorResponse(error.message, 500);
    }
});
