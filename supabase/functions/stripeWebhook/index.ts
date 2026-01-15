import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { errorResponse, successResponse } from "../_shared/response-helpers.ts";
import { createAdminClient } from "../_shared/supabase-client.ts";
import Stripe from "npm:stripe@17.4.0";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
    apiVersion: "2024-12-18.acacia",
});

const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

Deno.serve(async (req) => {
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
        return errorResponse("Missing stripe-signature header", 400);
    }

    try {
        const body = await req.text();

        // Verify webhook signature
        const event = stripe.webhooks.constructEvent(
            body,
            signature,
            webhookSecret,
        );

        console.log(`Received webhook event: ${event.type}`);

        // Handle different event types
        switch (event.type) {
            case "payment_method.attached":
                await handlePaymentMethodAttached(
                    event.data.object as Stripe.PaymentMethod,
                );
                break;

            case "payment_method.detached":
                await handlePaymentMethodDetached(
                    event.data.object as Stripe.PaymentMethod,
                );
                break;

            case "payment_method.updated":
            case "payment_method.automatically_updated":
                await handlePaymentMethodUpdated(
                    event.data.object as Stripe.PaymentMethod,
                );
                break;

            case "charge.succeeded":
                await handleChargeSucceeded(event.data.object as Stripe.Charge);
                break;

            case "charge.failed":
                await handleChargeFailed(event.data.object as Stripe.Charge);
                break;

            case "charge.refunded":
                await handleChargeRefunded(event.data.object as Stripe.Charge);
                break;

            case "customer.updated":
                await handleCustomerUpdated(
                    event.data.object as Stripe.Customer,
                );
                break;

            case "customer.deleted":
                await handleCustomerDeleted(
                    event.data.object as Stripe.Customer,
                );
                break;

            default:
                console.log(`Unhandled event type: ${event.type}`);
        }

        return successResponse({ received: true }, 200);
    } catch (err: unknown) {
        const error = err as Error;
        console.error("Webhook error:", error.message);
        return errorResponse(`Webhook Error: ${error.message}`, 400);
    }
});

async function handlePaymentMethodAttached(
    paymentMethod: Stripe.PaymentMethod,
) {
    console.log("Payment method attached:", paymentMethod.id);
    // Payment methods are already stored when added via API
}

async function handlePaymentMethodDetached(
    paymentMethod: Stripe.PaymentMethod,
) {
    console.log("Payment method detached:", paymentMethod.id);
    // Payment method is already removed when deleted via API
}

async function handlePaymentMethodUpdated(paymentMethod: Stripe.PaymentMethod) {
    console.log("Payment method updated:", paymentMethod.id);

    const adminClient = createAdminClient();

    // Update card expiration if it changed
    if (paymentMethod.card) {
        await adminClient
            .from("payment_methods")
            .update({
                exp_month: paymentMethod.card.exp_month,
                exp_year: paymentMethod.card.exp_year,
            })
            .eq("stripe_payment_method_id", paymentMethod.id);
    }
}

async function handleChargeSucceeded(charge: Stripe.Charge) {
    console.log("Charge succeeded:", charge.id);

    // Record in billing history if not already recorded
    // This is typically already handled by the chargePaymentMethod API
}

async function handleChargeFailed(charge: Stripe.Charge) {
    console.log("Charge failed:", charge.id, charge.failure_message);

    // You could send notifications to organization admins here
}

async function handleChargeRefunded(charge: Stripe.Charge) {
    console.log("Charge refunded:", charge.id);

    const adminClient = createAdminClient();

    // Update billing history to mark as refunded
    await adminClient
        .from("billing_history")
        .update({ status: "refunded" })
        .eq("stripe_charge_id", charge.id);
}

async function handleCustomerUpdated(customer: Stripe.Customer) {
    console.log("Customer updated:", customer.id);

    // Update default payment method if changed
    if (customer.invoice_settings?.default_payment_method) {
        const adminClient = createAdminClient();

        await adminClient
            .from("organizations")
            .update({
                stripe_default_payment_method: customer.invoice_settings
                    .default_payment_method as string,
            })
            .eq("stripe_customer_id", customer.id);
    }
}

async function handleCustomerDeleted(customer: Stripe.Customer) {
    console.log("Customer deleted:", customer.id);

    const adminClient = createAdminClient();

    // Clear Stripe customer ID from organization
    await adminClient
        .from("organizations")
        .update({
            stripe_customer_id: null,
            stripe_default_payment_method: null,
        })
        .eq("stripe_customer_id", customer.id);
}
