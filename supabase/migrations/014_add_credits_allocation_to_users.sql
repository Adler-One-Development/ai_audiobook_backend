-- Add credits_allocation_id column to users table
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS credits_allocation_id UUID REFERENCES public.credits_allocation(id) ON DELETE SET NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_credits_allocation_id ON public.users(credits_allocation_id);
