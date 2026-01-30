-- Add ElevenLabs related fields to projects table
ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS eleven_labs_project_id TEXT,
ADD COLUMN IF NOT EXISTS progress DOUBLE PRECISION DEFAULT 0.0;

-- Add constraint to ensure progress is between 0.0 and 1.0
ALTER TABLE public.projects
ADD CONSTRAINT progress_check CHECK (progress >= 0.0 AND progress <= 1.0);

COMMENT ON COLUMN public.projects.eleven_labs_project_id IS 'Project ID from ElevenLabs API';
COMMENT ON COLUMN public.projects.progress IS 'Progress of the audio generation, from 0.0 to 1.0';
