-- Drop chapter_ids column
ALTER TABLE public.studio
DROP COLUMN IF EXISTS chapter_ids;

-- Rename per_chapter_content_json to chapters
ALTER TABLE public.studio
RENAME COLUMN per_chapter_content_json TO chapters;
