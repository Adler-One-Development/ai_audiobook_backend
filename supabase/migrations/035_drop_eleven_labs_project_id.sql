-- Drop eleven_labs_project_id column from projects table
ALTER TABLE public.projects 
DROP COLUMN IF EXISTS eleven_labs_project_id;
