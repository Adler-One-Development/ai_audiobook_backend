-- Create credits_allocation table
CREATE TABLE IF NOT EXISTS public.credits_allocation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    credits_available INT NOT NULL DEFAULT 0,
    credits_used INT NOT NULL DEFAULT 0,
    total_credits_used INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.credits_allocation ENABLE ROW LEVEL SECURITY;

-- Create policy to allow users to read their own credits
CREATE POLICY "Users can view their own credits"
    ON public.credits_allocation
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Create policy to allow admins to manage credits
CREATE POLICY "Admins can manage credits"
    ON public.credits_allocation
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid()
            AND users.user_type IN ('ADMIN', 'OWNER')
        )
    );

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_credits_allocation_user_id ON public.credits_allocation(user_id);

-- Create unique constraint to ensure one credits record per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_credits_allocation_unique_user ON public.credits_allocation(user_id);
