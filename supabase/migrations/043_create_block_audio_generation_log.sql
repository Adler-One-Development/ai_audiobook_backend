-- Create block_audio_generation_log table
CREATE TABLE IF NOT EXISTS public.block_audio_generation_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  studio_id TEXT NOT NULL REFERENCES public.studio(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL,
  block_id TEXT NOT NULL,
  block_snapshot JSONB,
  credits_used NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.block_audio_generation_log ENABLE ROW LEVEL SECURITY;

-- Policies

-- Allow authenticated users to read logs (scoped to their projects/studios ideally, but simplistic for now as per patterns)
CREATE POLICY "Enable read access for authenticated users" 
ON public.block_audio_generation_log FOR SELECT 
TO authenticated 
USING (true);

-- Allow authenticated users to insert logs
CREATE POLICY "Enable insert access for authenticated users" 
ON public.block_audio_generation_log FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Allow authenticated users to update logs
CREATE POLICY "Enable update access for authenticated users" 
ON public.block_audio_generation_log FOR UPDATE 
TO authenticated 
USING (true);

-- Allow authenticated users to delete logs
CREATE POLICY "Enable delete access for authenticated users" 
ON public.block_audio_generation_log FOR DELETE 
TO authenticated 
USING (true);
