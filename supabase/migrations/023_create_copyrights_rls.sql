-- Enable RLS
ALTER TABLE public.copyrights ENABLE ROW LEVEL SECURITY;

-- Policy: Users can see copyrights of their organization
CREATE POLICY "Users can view copyrights of their organization"
    ON public.copyrights
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.organizations
            WHERE organizations.id = copyrights.organization_id
            AND (organizations.owner_id = auth.uid() OR auth.uid() = ANY(organizations.member_ids))
        )
    );

-- Policy: Organization owners and members can manage copyrights
-- INSERT
CREATE POLICY "Organization members can insert copyrights"
    ON public.copyrights
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.organizations
            WHERE organizations.id = copyrights.organization_id
            AND (organizations.owner_id = auth.uid() OR auth.uid() = ANY(organizations.member_ids))
        )
    );

-- UPDATE
CREATE POLICY "Organization members can update copyrights"
    ON public.copyrights
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.organizations
            WHERE organizations.id = copyrights.organization_id
            AND (organizations.owner_id = auth.uid() OR auth.uid() = ANY(organizations.member_ids))
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.organizations
            WHERE organizations.id = copyrights.organization_id
            AND (organizations.owner_id = auth.uid() OR auth.uid() = ANY(organizations.member_ids))
        )
    );

-- DELETE
CREATE POLICY "Organization members can delete copyrights"
    ON public.copyrights
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.organizations
            WHERE organizations.id = copyrights.organization_id
            AND (organizations.owner_id = auth.uid() OR auth.uid() = ANY(organizations.member_ids))
        )
    );
