-- Add organization_id to users table
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

-- Create index on organization_id for faster joins
CREATE INDEX IF NOT EXISTS idx_users_organization_id ON public.users(organization_id);
