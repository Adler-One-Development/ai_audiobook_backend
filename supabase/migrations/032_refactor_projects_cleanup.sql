-- Add studio_id column to projects table
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS studio_id UUID;

-- Backfill studio_id from book JSONB column
UPDATE public.projects
SET studio_id = (book->>'studio_id')::UUID
WHERE book->>'studio_id' IS NOT NULL;

-- Remove keys from book JSONB column to avoid redundancy
UPDATE public.projects
SET book = book - 'gallery_id' - 'genre_id' - 'studio_id';
