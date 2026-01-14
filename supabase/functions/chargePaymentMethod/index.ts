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
        const { numberOfCredits } = await req.json(); // Changed from amount/currency to numberOfCredits

        if (!numberOfCredits || numberOfCredits <= 0) {
            return errorResponse(
                "numberOfCredits is required and must be greater than 0",
                400,
            );
        }

        // Get Requesting User and Organization
        const { user, organization, error } = await getOrganization(
            req,
            supabaseClient,
        );
        if (error || !user || !organization) {
            return errorResponse(error || "Unauthorized", 401);
        }

        // Only ADMIN/OWNER can charge payment methods
        if (user.user_type !== "ADMIN" && user.user_type !== "OWNER") {
            return errorResponse("Only admins can purchase credits", 403);
        }

        if (!organization.stripe_customer_id) {
            return errorResponse(
                "Organization has no payment account configured",
                400,
            );
        }

        const startTime = Date.now();

        // 1. Fetch Pricing
        const { data: pricingData, error: pricingError } = await supabaseClient
            .from("credits_pricing")
            .select("price_per_credit")
            .limit(1)
            .single();

        if (pricingError || !pricingData) {
            throw new Error("Failed to fetch credits pricing configuration");
        }

        const pricePerCredit = pricingData.price_per_credit;
        const amountToCharge = numberOfCredits * pricePerCredit;
        const currency = "usd";

        // 2. Determine payment method (Default only for now as per simplicity, or could pass in ID)
        const customer = await stripe.customers.retrieve(
            organization.stripe_customer_id,
        );
        const paymentMethodToUse = (customer as any).invoice_settings
            ?.default_payment_method;

        if (!paymentMethodToUse) {
            return errorResponse("No default payment method found", 400);
        }

        // 3. Create PaymentIntent (Charge)
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amountToCharge * 100), // Convert to cents
            currency: currency,
            customer: organization.stripe_customer_id,
            payment_method: paymentMethodToUse,
            description: `Purchase of ${numberOfCredits} credits`,
            confirm: true,
            automatic_payment_methods: {
                enabled: true,
                allow_redirects: "never",
            },
            metadata: {
                organization_id: organization.id,
                user_id: user.id,
                credits: numberOfCredits,
                price_per_credit: pricePerCredit,
            },
        });

        if (paymentIntent.status !== "succeeded") {
            return errorResponse(
                `Payment failed with status: ${paymentIntent.status}`,
                400,
            );
        }

        // 4. Update Credits Allocation (Add credits)
        // We strictly use rpc or direct update. Since we have credits_allocation table:
        // We need to upsert or update.

        // First check if allocation exists for this user
        const { data: allocation } = await supabaseClient
            .from("credits_allocation")
            .select("*")
            .eq("user_id", user.id)
            .single();

        if (allocation) {
            await supabaseClient
                .from("credits_allocation")
                .update({
                    credits_available: allocation.credits_available +
                        numberOfCredits,
                    // We might want to track 'total_credits_purchased' but schema has 'total_credits_used'.
                    // For now just updating available.
                    updated_at: new Date().toISOString(),
                })
                .eq("user_id", user.id);
        } else {
            await supabaseClient
                .from("credits_allocation")
                .insert({
                    user_id: user.id,
                    credits_available: numberOfCredits,
                    credits_used: 0,
                    total_credits_used: 0,
                });
        }

        // 5. Record Transaction in Billing History (via simple insert or rely on webhook?)
        // User asked for /getBillingHistory so we should probably record it or rely on Stripe.
        // Our /getBillingHistory currently fetches from Stripe directly, so we don't need to insert into a local table!
        // Perfect.

        return successResponse({
            status: "success",
            message: "Credits purchased successfully",
            purchase: {
                credits_added: numberOfCredits,
                amount_charged: amountToCharge,
                currency: currency,
                price_per_credit: pricePerCredit,
                transaction_id: paymentIntent.id,
            },
            processingTimeMs: Date.now() - startTime,
        }, 200);
    } catch (error: any) {
        console.error("chargePaymentMethod error:", error);
        return errorResponse(error.message, 500);
    }
});
