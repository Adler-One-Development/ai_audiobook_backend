-- Add new fields to projects table
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS duration INTERVAL DEFAULT INTERVAL '0 seconds',
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Processing' CHECK (status IN ('Processing', 'InProgress', 'Completed')),
ADD COLUMN IF NOT EXISTS chapters_and_pages TEXT DEFAULT '';

-- Create index on status for filtering
CREATE INDEX IF NOT EXISTS idx_projects_status ON public.projects(status);
