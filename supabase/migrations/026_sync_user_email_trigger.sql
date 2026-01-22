-- Create a function to sync email updates from auth.users to public.users
CREATE OR REPLACE FUNCTION public.handle_user_email_update()
RETURNS TRIGGER AS $$
BEGIN
    -- Only update if the email has actually changed
    IF NEW.email IS DISTINCT FROM OLD.email THEN
        UPDATE public.users
        SET 
            email = NEW.email,
            updated_at = NOW()
        WHERE id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
    AFTER UPDATE ON auth.users
    FOR EACH ROW
    WHEN (OLD.email IS DISTINCT FROM NEW.email)
    EXECUTE FUNCTION public.handle_user_email_update();
