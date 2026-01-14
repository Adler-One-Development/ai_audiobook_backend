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
        const { numberOfCredits, payment_method_id, description } = await req
            .json();

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

        // 2. Determine payment method
        let paymentMethodToUse = payment_method_id;
        if (!paymentMethodToUse) {
            const customer = await stripe.customers.retrieve(
                organization.stripe_customer_id,
            );
            const defaultPm = (customer as any).invoice_settings
                ?.default_payment_method;
            if (!defaultPm) {
                return errorResponse(
                    "No default payment method found and none provided",
                    400,
                );
            }
            paymentMethodToUse = defaultPm;
        }

        // 3. Create PaymentIntent (Charge)
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amountToCharge * 100), // Convert to cents
            currency: currency,
            customer: organization.stripe_customer_id,
            payment_method: paymentMethodToUse,
            description: description ||
                `Purchase of ${numberOfCredits} credits`,
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
