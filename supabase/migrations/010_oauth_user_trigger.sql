-- Create a function to automatically set up new OAuth users
CREATE OR REPLACE FUNCTION handle_new_oauth_user()
RETURNS TRIGGER AS $$
DECLARE
    org_id UUID;
    user_full_name TEXT;
    google_picture_url TEXT;
BEGIN
    -- Check if user already exists in users table
    IF EXISTS (SELECT 1 FROM public.users WHERE id = NEW.id) THEN
        RETURN NEW;
    END IF;

    -- Extract full name from raw_user_meta_data
    user_full_name := COALESCE(
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'name',
        SPLIT_PART(NEW.email, '@', 1)
    );

    -- Extract Google profile picture URL if exists
    google_picture_url := COALESCE(
        NEW.raw_user_meta_data->>'picture',
        NEW.raw_user_meta_data->>'avatar_url'
    );

    -- Create organization for the new user
    INSERT INTO public.organizations (owner_id, member_ids)
    VALUES (NEW.id, '{}')
    RETURNING id INTO org_id;

    -- Insert user record
    INSERT INTO public.users (
        id,
        full_name,
        email,
        user_type,
        organization_id
    ) VALUES (
        NEW.id,
        user_full_name,
        NEW.email,
        'ADMIN',
        org_id
    );

    -- If Google picture exists, call edge function to sync it
    IF google_picture_url IS NOT NULL AND google_picture_url != '' THEN
        PERFORM extensions.http_post(
            url := 'https://hskaqvjruqzmgrwxmxxd.supabase.co/functions/v1/syncGoogleProfilePicture',
            headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhza2FxdmpydXF6bWdyd3hteHhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgyMzc5NDUsImV4cCI6MjA4MzgxMzk0NX0.QHdr1A14du_t_hiE5_a652iwgyGuXfl7VdSLkrsfILQ"}'::jsonb,
            body := jsonb_build_object(
                'user_id', NEW.id::text,
                'picture_url', google_picture_url
            )
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new auth users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_oauth_user();
