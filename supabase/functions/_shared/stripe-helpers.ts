import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.4.0";

export const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
    apiVersion: "2024-12-18.acacia",
});

export async function getOrCreateStripeCustomer(
    supabaseClient: SupabaseClient,
    organizationId: string,
    email: string,
): Promise<string> {
    // Check if organization already has stripe_customer_id
    const { data: org, error } = await supabaseClient
        .from("organizations")
        .select("stripe_customer_id")
        .eq("id", organizationId)
        .single();

    if (error) {
        throw new Error(`Failed to fetch organization: ${error.message}`);
    }

    if (org.stripe_customer_id) {
        return org.stripe_customer_id;
    }

    // Create new customer in Stripe
    const customer = await stripe.customers.create({
        email,
        metadata: {
            organization_id: organizationId,
        },
    });

    // Save stripe_customer_id to organization
    const { error: updateError } = await supabaseClient
        .from("organizations")
        .update({ stripe_customer_id: customer.id })
        .eq("id", organizationId);

    if (updateError) {
        throw new Error(
            `Failed to update organization with stripe_customer_id: ${updateError.message}`,
        );
    }

    return customer.id;
}
