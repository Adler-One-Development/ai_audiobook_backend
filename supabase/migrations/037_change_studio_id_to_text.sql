-- Change studio.id from UUID to TEXT to support ElevenLabs project IDs
ALTER TABLE public.studio 
ALTER COLUMN id TYPE TEXT;

-- Also update projects.studio_id to TEXT
ALTER TABLE public.projects 
ALTER COLUMN studio_id TYPE TEXT;
