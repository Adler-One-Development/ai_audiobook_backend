-- Add access control columns to projects table
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS access_levels UUID[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id);

-- Add comments
COMMENT ON COLUMN public.projects.owner_id IS 'User ID of the project owner.';
COMMENT ON COLUMN public.projects.access_levels IS 'List of Organization UUIDs that have shared access to this project.';
COMMENT ON COLUMN public.projects.organization_id IS 'Organization ID that owns this project.';
