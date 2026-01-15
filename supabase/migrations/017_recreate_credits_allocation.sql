-- Recreate credits_allocation table (handles case where it doesn't exist)
DROP TABLE IF EXISTS public.credits_allocation CASCADE;

CREATE TABLE public.credits_allocation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    credits_available INT NOT NULL DEFAULT 0,
    credits_used INT NOT NULL DEFAULT 0,
    total_credits_used INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE public.credits_allocation ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own credits" ON public.credits_allocation;
DROP POLICY IF EXISTS "Admins can manage credits" ON public.credits_allocation;

-- Create policies
CREATE POLICY "Users can view their own credits"
    ON public.credits_allocation
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

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

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_credits_allocation_user_id ON public.credits_allocation(user_id);

-- Add credits_allocation_id to users table if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'credits_allocation_id'
    ) THEN
        ALTER TABLE public.users
        ADD COLUMN credits_allocation_id UUID REFERENCES public.credits_allocation(id) ON DELETE SET NULL;
        
        CREATE INDEX idx_users_credits_allocation_id ON public.users(credits_allocation_id);
    END IF;
END $$;
