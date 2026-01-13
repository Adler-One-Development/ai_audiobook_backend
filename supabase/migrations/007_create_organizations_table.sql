-- Create organizations table
CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    member_ids UUID[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Policies for organizations
-- Users can read their own organization (where they are owner or member)
CREATE POLICY "Users can read their organization"
    ON public.organizations
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = owner_id OR 
        auth.uid() = ANY(member_ids)
    );

-- Only owners can update their organization
CREATE POLICY "Owners can update their organization"
    ON public.organizations
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

-- Only owners can delete their organization
CREATE POLICY "Owners can delete their organization"
    ON public.organizations
    FOR DELETE
    TO authenticated
    USING (auth.uid() = owner_id);

-- Users can create organizations
CREATE POLICY "Users can create organizations"
    ON public.organizations
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = owner_id);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_organizations_owner ON public.organizations(owner_id);
CREATE INDEX IF NOT EXISTS idx_organizations_members ON public.organizations USING GIN(member_ids);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_organization_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_organization_updated_at
    BEFORE UPDATE ON public.organizations
    FOR EACH ROW
    EXECUTE FUNCTION update_organization_updated_at();
