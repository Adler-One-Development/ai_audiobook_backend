-- Helper function to add a member to an organization
CREATE OR REPLACE FUNCTION add_organization_member(org_id UUID, user_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE public.organizations
    SET member_ids = array_append(member_ids, user_id)
    WHERE id = org_id
    AND NOT (user_id = ANY(member_ids));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to remove a member from an organization
CREATE OR REPLACE FUNCTION remove_organization_member(org_id UUID, user_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE public.organizations
    SET member_ids = array_remove(member_ids, user_id)
    WHERE id = org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
