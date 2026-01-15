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
        const { payment_method_id, exp_month, exp_year, name } = await req
            .json();

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

        // Only ADMIN/OWNER can manage payment methods
        if (user.user_type !== "ADMIN" && user.user_type !== "OWNER") {
            return errorResponse("Only admins can manage payment methods", 403);
        }

        const startTime = Date.now();

        // Prepare update object
        const updateParams: any = {};
        if (exp_month || exp_year) {
            updateParams.card = {};
            if (exp_month) updateParams.card.exp_month = exp_month;
            if (exp_year) updateParams.card.exp_year = exp_year;
        }
        if (name) {
            updateParams.billing_details = { name };
        }

        // Update Payment Method in Stripe
        const paymentMethod = await stripe.paymentMethods.update(
            payment_method_id,
            updateParams,
        );

        // Check if it's default
        const customer = await stripe.customers.retrieve(
            organization.stripe_customer_id!,
        );
        const isDefault =
            (customer as any).invoice_settings?.default_payment_method ===
                paymentMethod.id;

        return successResponse({
            status: "success",
            message: "Payment method updated successfully",
            payment_method: {
                id: paymentMethod.id,
                type: paymentMethod.type,
                card: {
                    brand: paymentMethod.card?.brand,
                    last4: paymentMethod.card?.last4,
                    exp_month: paymentMethod.card?.exp_month,
                    exp_year: paymentMethod.card?.exp_year,
                },
                billing_details: {
                    name: paymentMethod.billing_details.name,
                },
                is_default: isDefault,
            },
            processingTimeMs: Date.now() - startTime,
        }, 200);
    } catch (error: any) {
        console.error("updatePaymentMethod error:", error);
        return errorResponse(error.message, 500);
    }
});
