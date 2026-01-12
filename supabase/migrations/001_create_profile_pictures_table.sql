-- Create profile_pictures table
CREATE TABLE IF NOT EXISTS public.profile_pictures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.profile_pictures ENABLE ROW LEVEL SECURITY;

-- Create policy to allow authenticated users to read profile pictures
CREATE POLICY "Allow authenticated users to read profile pictures"
    ON public.profile_pictures
    FOR SELECT
    TO authenticated
    USING (true);

-- Create policy to allow users to insert their own profile pictures
CREATE POLICY "Allow authenticated users to insert profile pictures"
    ON public.profile_pictures
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Create index on id for faster lookups
CREATE INDEX IF NOT EXISTS idx_profile_pictures_id ON public.profile_pictures(id);
