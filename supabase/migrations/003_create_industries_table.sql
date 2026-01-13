-- Create industries table
CREATE TABLE IF NOT EXISTS public.industries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    industry_name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.industries ENABLE ROW LEVEL SECURITY;

-- Create policy to allow anyone to read industries (public data)
CREATE POLICY "Anyone can read industries"
    ON public.industries
    FOR SELECT
    TO authenticated, anon
    USING (true);

-- Create index on industry_name for faster lookups
CREATE INDEX IF NOT EXISTS idx_industries_name ON public.industries(industry_name);

-- Insert common book publishing industries
INSERT INTO public.industries (industry_name) VALUES
    ('Academic Publishing'),
    ('Children''s Books'),
    ('Educational Publishing'),
    ('Fiction & Literature'),
    ('Non-Fiction'),
    ('Religious & Spiritual'),
    ('Science & Technology'),
    ('Self-Publishing'),
    ('Textbook Publishing'),
    ('Trade Publishing'),
    ('Young Adult'),
    ('Comics & Graphic Novels'),
    ('Poetry'),
    ('Biography & Memoir'),
    ('Business & Economics'),
    ('Health & Wellness'),
    ('Travel & Guide Books'),
    ('Cookbooks & Food'),
    ('Arts & Photography'),
    ('Other')
ON CONFLICT (industry_name) DO NOTHING;
