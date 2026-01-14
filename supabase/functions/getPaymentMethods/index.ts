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

        // Get Requesting User and Organization
        const { user, profile, organization, error } = await getOrganization(
            req,
            supabaseClient,
        );
        if (error || !user || !organization) {
            return errorResponse(error || "Unauthorized", 401);
        }

        // Only ADMIN/OWNER can view payment methods
        if (profile?.user_type !== "ADMIN" && profile?.user_type !== "OWNER") {
            return errorResponse("Only admins can view payment methods", 403);
        }

        const startTime = Date.now();

        if (!organization.stripe_customer_id) {
            return successResponse({
                status: "success",
                message: "No payment methods found",
                payment_methods: [],
                processingTimeMs: Date.now() - startTime,
            }, 200);
        }

        // List Payment Methods from Stripe
        const paymentMethods = await stripe.paymentMethods.list({
            customer: organization.stripe_customer_id,
            type: "card",
        });

        // Get Customer to check default payment method
        const customer = await stripe.customers.retrieve(
            organization.stripe_customer_id,
        );
        const defaultPaymentMethodId = (customer as any).invoice_settings
            ?.default_payment_method;

        const formattedPaymentMethods = paymentMethods.data.map((pm) => ({
            id: pm.id,
            type: pm.type,
            card: {
                brand: pm.card?.brand,
                last4: pm.card?.last4,
                exp_month: pm.card?.exp_month,
                exp_year: pm.card?.exp_year,
            },
            is_default: pm.id === defaultPaymentMethodId,
        }));

        return successResponse({
            status: "success",
            message: "Payment methods fetched successfully",
            payment_methods: formattedPaymentMethods,
            processingTimeMs: Date.now() - startTime,
        }, 200);
    } catch (error: any) {
        console.error("getPaymentMethods error:", error);
        return errorResponse(error.message, 500);
    }
});
