-- Add timestamp columns to projects table
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Create index on created_at for faster sorting
CREATE INDEX IF NOT EXISTS idx_projects_created_at ON public.projects(created_at DESC);
