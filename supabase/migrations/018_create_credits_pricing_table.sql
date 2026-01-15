-- Create credits_pricing table
CREATE TABLE IF NOT EXISTS public.credits_pricing (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    price_per_credit DECIMAL(10, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.credits_pricing ENABLE ROW LEVEL SECURITY;

-- Create policy to allow authenticated users to view pricing
CREATE POLICY "Authenticated users can view pricing"
    ON public.credits_pricing
    FOR SELECT
    TO authenticated
    USING (true);

-- Create policy to allow admins to manage pricing
CREATE POLICY "Admins can manage pricing"
    ON public.credits_pricing
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid()
            AND users.user_type IN ('ADMIN', 'OWNER')
        )
    );
