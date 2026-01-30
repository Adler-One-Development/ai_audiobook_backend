-- Add gallery_id column to projects table
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS gallery_id UUID REFERENCES public.galleries(id);

-- Backfill gallery_id from book JSONB column
UPDATE public.projects
SET gallery_id = (book->>'gallery_id')::UUID
WHERE book->>'gallery_id' IS NOT NULL;
