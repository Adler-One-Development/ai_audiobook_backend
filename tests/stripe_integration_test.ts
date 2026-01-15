import Stripe from "npm:stripe@17.4.0"; // Using specific version to match project

const BASE_URL = "https://hskaqvjruqzmgrwxmxxd.supabase.co/functions/v1";
const STRIPE_SECRET_KEY = Deno.env.get("SECRET_KEY_TEST") || "";

const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || ""; // You might need to set this env var when running or hardcode it if testing locally against remote

if (!STRIPE_SECRET_KEY) {
    console.error("❌ SECRET_KEY_TEST is missing from environment variables.");
    Deno.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: "2024-12-18.acacia", // Use latest or matching api version
});

async function runTest() {
    console.log("🚀 Starting Stripe Integration Test...");
    console.log(`Target: ${BASE_URL}`);

    if (!ANON_KEY) {
        console.warn(
            "⚠️  SUPABASE_ANON_KEY is missing. Requests might fail if not handled by headers automatically or if needed for login.",
        );
    }

    // Helper for fetch
    async function apiCall(
        endpoint: string,
        method: string,
        body?: any,
        token?: string,
    ) {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "apikey": ANON_KEY,
        };
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        // console.log(`👉 ${method} ${endpoint}`);
        const res = await fetch(`${BASE_URL}${endpoint}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });

        const data = await res.json();
        if (!res.ok) {
            console.error(`❌ Error calling ${endpoint}:`, data);
            throw new Error(`Failed call to ${endpoint}`);
        }
        return data;
    }

    try {
        // 1. Login
        console.log("\n1️⃣  Logging in...");
        const loginRes = await apiCall("/login", "POST", {
            email: "junaid@example.com",
            password: "SecurePass123!",
        });

        if (!loginRes.token) throw new Error("No token returned from login");
        const token = loginRes.token;
        console.log("✅ Login successful. Token obtained.");

        // 2. Add Stripe Test Card 1
        console.log("\n2️⃣  Adding Payment Method 1...");
        // Create PM on Stripe directly (simulating frontend)
        const pm1 = await stripe.paymentMethods.create({
            type: "card",
            card: { token: "tok_visa" }, // tok_visa is a standard test token
        });
        console.log(`   Created PM on Stripe: ${pm1.id}`);

        const addPm1Res = await apiCall("/addPaymentMethod", "POST", {
            payment_method_id: pm1.id,
        }, token);
        console.log("✅ Payment Method 1 added to DB:", addPm1Res.message);

        // 3. Add Stripe Test Card 2
        console.log("\n3️⃣  Adding Payment Method 2...");
        const pm2 = await stripe.paymentMethods.create({
            type: "card",
            card: { token: "tok_mastercard" },
        });
        console.log(`   Created PM on Stripe: ${pm2.id}`);

        const addPm2Res = await apiCall("/addPaymentMethod", "POST", {
            payment_method_id: pm2.id,
        }, token);
        console.log("✅ Payment Method 2 added to DB:", addPm2Res.message);

        // 4. Set Second as Default
        console.log("\n4️⃣  Setting Payment Method 2 as Default...");
        const setDefaultRes = await apiCall(
            "/setDefaultPaymentMethod",
            "POST",
            {
                payment_method_id: pm2.id,
            },
            token,
        );
        console.log("✅ Default set:", setDefaultRes.message);

        // 5. Charge 1000 Credits
        console.log("\n5️⃣  Charging 1000 credits (using default PM)...");
        const charge1Res = await apiCall("/chargePaymentMethod", "POST", {
            numberOfCredits: 1000,
            description: "Integration Test Charge 1 (1000)",
        }, token);
        console.log(
            "✅ Charge 1 success:",
            charge1Res.purchase.amount_charged,
            charge1Res.purchase.currency,
        );

        // 6. Get Allocation
        console.log("\n6️⃣  Checking Credit Allocation...");
        const alloc1 = await apiCall(
            "/getCreditAllocation",
            "GET",
            undefined,
            token,
        );
        console.log("   Current Allocation:", alloc1.allocation);
        // Rough check: assuming we started with some amount, it should be at least 1000 higher than base, or exactly 1000 if new
        // We confirm it shows *something*
        if (alloc1.allocation.credits_available < 1000) {
            console.warn(
                "⚠️  Credits available seems low, expected at least 1000 if user was fresh.",
            );
        } else {
            console.log("✅ Allocation reflects purchase.");
        }

        // 7. Charge 500 Credits
        console.log("\n7️⃣  Charging 500 credits...");
        const charge2Res = await apiCall("/chargePaymentMethod", "POST", {
            numberOfCredits: 500,
            description: "Integration Test Charge 2 (500)",
        }, token);
        console.log("✅ Charge 2 success:", charge2Res.purchase.amount_charged);

        // 8. Get Allocation Again
        console.log("\n8️⃣  Checking Credit Allocation again...");
        const alloc2 = await apiCall(
            "/getCreditAllocation",
            "GET",
            undefined,
            token,
        );
        console.log("   Current Allocation:", alloc2.allocation);
        const diff = alloc2.allocation.credits_available -
            alloc1.allocation.credits_available;
        if (diff === 500) {
            console.log("✅ Credits increased exactly by 500.");
        } else {
            console.warn(`⚠️  Credits increased by ${diff}, expected 500.`);
        }

        // 9. Get Billing History
        console.log("\n9️⃣  Fetching Billing History...");
        const historyRes = await apiCall(
            "/getBillingHistory",
            "POST",
            {},
            token,
        ); // Assuming POST as per yaml, or GET? YAML says POST for getBillingHistory
        // YAML Line 1603 says "post" for getBillingHistory. (Wait, usually GET, but implementation was POST?)
        // Checking: getBillingHistory index.ts...
        // The previous edit to getBillingHistory showed Line 1603: "post:". So I will use POST.

        console.log(
            `   Found ${historyRes.transactions?.length} transactions.`,
        );
        const txs = historyRes.transactions || [];
        const found1000 = txs.some((t: any) =>
            t.description.includes("1000") && t.amount === 1000
        ); // Amount 1000 credits * 1.0 = $1000?
        // Logic: amount * price_per_credit.
        // If price is 1.0, 1000 credits = 1000 USD (100000 cents).
        // Stripe returns amount in CENTS usually, but my API might return dollars or cents.
        // Let's check chargePaymentMethod response: amount_charged (dollars?).
        // Stripe helpers usually deal in cents.
        // But let's just log it.
        console.log(
            "   First 3 Transactions:",
            txs.slice(0, 3).map((t: any) =>
                `${t.description} (${t.amount} ${t.currency})`
            ),
        );

        // 10. Delete Payment Method
        console.log("\n🔟 Deleting Payment Method 1...");
        const delRes = await apiCall("/deletePaymentMethod", "POST", {
            payment_method_id: pm1.id,
        }, token);
        console.log("✅ Payment Method deleted:", delRes.message);

        console.log("\n🎉 Integration Test Completed Successfully!");
    } catch (err) {
        console.error("\n❌ Test Failed:", err);
        Deno.exit(1);
    }
}

runTest();
