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

        const startTime = Date.now();

        // Detach Payment Method from Customer (effectively deleting it from the user's list)
        await stripe.paymentMethods.detach(payment_method_id);

        return successResponse({
            status: "success",
            message: "Payment method deleted successfully",
            processingTimeMs: Date.now() - startTime,
        }, 200);
    } catch (error: any) {
        console.error("deletePaymentMethod error:", error);
        return errorResponse(error.message, 500);
    }
});
