-- Create genres table
CREATE TABLE IF NOT EXISTS public.genres (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  genre_name TEXT NOT NULL UNIQUE
);

-- Enable RLS for genres
ALTER TABLE public.genres ENABLE ROW LEVEL SECURITY;

-- Create galleries table
CREATE TABLE IF NOT EXISTS public.galleries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cover_image JSONB,
  files JSONB
);

-- Enable RLS for galleries
ALTER TABLE public.galleries ENABLE ROW LEVEL SECURITY;

-- Create projects table
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  book JSONB NOT NULL
);

-- Enable RLS for projects
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;


-- Populate genres (Common Book Genres)
INSERT INTO public.genres (genre_name) VALUES
('Fiction'),
('Non-fiction'),
('Mystery'),
('Thriller'),
('Science Fiction'),
('Fantasy'),
('Romance'),
('Historical Fiction'),
('Horror'),
('Biography'),
('Autobiography'),
('Memoir'),
('Self-Help'),
('Business'),
('History'),
('Science'),
('Travel'),
('Poetry'),
('Cookbooks'),
('Children''s'),
('Young Adult'),
('Classic'),
('Graphic Novel'),
('Adventure'),
('True Crime'),
('Humor'),
('Essay'),
('Spirituality')
ON CONFLICT (genre_name) DO NOTHING;


-- Create Storage Buckets
-- Note: 'storage' schema is managed by Supabase. We insert directly into storage.buckets.
INSERT INTO storage.buckets (id, name, public) 
VALUES ('cover_images', 'cover_images', true) 
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public) 
VALUES ('files', 'files', true) 
ON CONFLICT (id) DO NOTHING;


-- Basic Policies (To allow usage in QA/Dev immediately, can be refined later)

-- Genres: Readable by everyone (authenticated or anon often needed for signup/public pages, but let's stick to authenticated for backend focus)
CREATE POLICY "Enable read access for all users" ON public.genres FOR SELECT USING (true);

-- Galleries: Readable by authenticated users
CREATE POLICY "Enable read access for authenticated users" ON public.galleries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable insert access for authenticated users" ON public.galleries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Enable update access for authenticated users" ON public.galleries FOR UPDATE TO authenticated USING (true);

-- Projects: 
CREATE POLICY "Enable read access for authenticated users" ON public.projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable insert access for authenticated users" ON public.projects FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Enable update access for authenticated users" ON public.projects FOR UPDATE TO authenticated USING (true);

-- Storage Policies
-- Cover Images
CREATE POLICY "Give public read access to cover_images" ON storage.objects FOR SELECT USING (bucket_id = 'cover_images');
CREATE POLICY "Enable insert access for auth users to cover_images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'cover_images');
CREATE POLICY "Enable update access for auth users to cover_images" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'cover_images');

-- Files
CREATE POLICY "Give public read access to files" ON storage.objects FOR SELECT USING (bucket_id = 'files');
CREATE POLICY "Enable insert access for auth users to files" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'files');
CREATE POLICY "Enable update access for auth users to files" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'files');
