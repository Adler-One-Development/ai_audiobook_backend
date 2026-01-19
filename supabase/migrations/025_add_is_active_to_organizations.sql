-- Add is_active column to organizations table for organization deactivation
-- Default is TRUE (active) for all organizations

ALTER TABLE public.organizations 
ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Add index for performance
CREATE INDEX idx_organizations_is_active ON public.organizations(is_active);

-- Add comment
COMMENT ON COLUMN public.organizations.is_active IS 'Indicates if organization is active. Inactive organizations prevent all members from logging in.';
