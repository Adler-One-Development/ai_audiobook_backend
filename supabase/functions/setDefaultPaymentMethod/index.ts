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
        const { payment_method_id } = await req.json();

        if (!payment_method_id) {
            return errorResponse("payment_method_id is required", 400);
        }

        // Get Requesting User and Organization
        const { user, profile, organization, error } = await getOrganization(
            req,
            supabaseClient,
        );
        if (error || !user || !organization) {
            return errorResponse(error || "Unauthorized", 401);
        }

        // Only ADMIN/OWNER can manage payment methods
        if (profile?.user_type !== "ADMIN" && profile?.user_type !== "OWNER") {
            return errorResponse("Only admins can manage payment methods", 403);
        }

        if (!organization.stripe_customer_id) {
            return errorResponse(
                "Organization has no payment account configured",
                400,
            );
        }

        const startTime = Date.now();

        // Update Customer Default Payment Method
        await stripe.customers.update(organization.stripe_customer_id, {
            invoice_settings: {
                default_payment_method: payment_method_id,
            },
        });

        // Fetch the updated payment method details to return
        const paymentMethod = await stripe.paymentMethods.retrieve(
            payment_method_id,
        );

        return successResponse({
            status: "success",
            message: "Default payment method updated successfully",
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
        console.error("setDefaultPaymentMethod error:", error);
        return errorResponse(error.message, 500);
    }
});
