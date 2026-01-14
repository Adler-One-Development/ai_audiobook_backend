import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    errorResponse,
    handleCorsPreFlight,
    successResponse,
} from "../_shared/response-helpers.ts";
import { createClient } from "../_shared/supabase-client.ts";
import {
    getOrCreateStripeCustomer,
    stripe,
} from "../_shared/stripe-helpers.ts";
import { getOrganization } from "../_shared/auth-helpers.ts";

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return handleCorsPreFlight();

    try {
        const supabaseClient = createClient(req);
        const { payment_method_id } = await req.json();

        if (!payment_method_id) {
            return errorResponse("payment_method_id is required", 400);
        }

        // Get Requesting User and Organization
        const { user, organization, error } = await getOrganization(
            req,
            supabaseClient,
        );
        if (error || !user || !organization) {
            return errorResponse(error || "Unauthorized", 401);
        }

        // Only ADMIN/OWNER can add payment methods
        if (user.user_type !== "ADMIN" && user.user_type !== "OWNER") {
            return errorResponse("Only admins can add payment methods", 403);
        }

        const startTime = Date.now();

        // Get or Create Stripe Customer
        const stripeCustomerId = await getOrCreateStripeCustomer(
            supabaseClient,
            organization.id,
            user.email!,
        );

        // Attach Payment Method to Customer
        const paymentMethod = await stripe.paymentMethods.attach(
            payment_method_id,
            {
                customer: stripeCustomerId,
            },
        );

        // Set as default payment method
        await stripe.customers.update(stripeCustomerId, {
            invoice_settings: {
                default_payment_method: payment_method_id,
            },
        });

        return successResponse({
            status: "success",
            message: "Payment method added and set as default",
            payment_method: {
                id: paymentMethod.id,
                type: paymentMethod.type,
                card: {
                    brand: paymentMethod.card?.brand,
                    last4: paymentMethod.card?.last4,
                    exp_month: paymentMethod.card?.exp_month,
                    exp_year: paymentMethod.card?.exp_year,
                },
                is_default: true,
            },
            processingTimeMs: Date.now() - startTime,
        }, 200);
    } catch (error: any) {
        console.error("addPaymentMethod error:", error);
        return errorResponse(error.message, 500);
    }
});
