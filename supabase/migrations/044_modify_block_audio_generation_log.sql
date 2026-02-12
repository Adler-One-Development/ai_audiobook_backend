-- Remove credits_used column
ALTER TABLE public.block_audio_generation_log
DROP COLUMN IF EXISTS credits_used;

-- Add unique constraint to ensure only one log entry per block
ALTER TABLE public.block_audio_generation_log
ADD CONSTRAINT unique_block_generation_log UNIQUE (project_id, studio_id, chapter_id, block_id);
