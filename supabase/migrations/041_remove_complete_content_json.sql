-- Drop complete_content_json column from studio table
ALTER TABLE public.studio
DROP COLUMN IF EXISTS complete_content_json;
