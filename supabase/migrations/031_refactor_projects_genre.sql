-- Add genre_id column to projects table
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS genre_id UUID REFERENCES public.genres(id);

-- Backfill genre_id from book JSONB column
UPDATE public.projects
SET genre_id = (book->>'genre_id')::UUID
WHERE book->>'genre_id' IS NOT NULL;
