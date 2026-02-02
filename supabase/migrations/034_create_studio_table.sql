-- Create studio table
CREATE TABLE IF NOT EXISTS public.studio (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_ids UUID[] DEFAULT '{}',
    complete_content_json JSONB DEFAULT '{}'::jsonb,
    gallery_id UUID REFERENCES public.galleries(id) ON DELETE SET NULL,
    per_chapter_content_json JSONB DEFAULT '[]'::jsonb,
    voices JSONB DEFAULT '[]'::jsonb,
    comments JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.studio ENABLE ROW LEVEL SECURITY;

-- Create policy for authenticated users (Full Access)
-- Note: Logic can be refined later to restrict based on project ownership if needed.
CREATE POLICY "Authenticated users can access studio"
    ON public.studio
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Create index on gallery_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_studio_gallery_id ON public.studio(gallery_id);
