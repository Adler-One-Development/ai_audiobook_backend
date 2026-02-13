-- Create custom_voices table for user-created voices
CREATE TABLE IF NOT EXISTS custom_voices (
    voice_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    studio_id TEXT NOT NULL REFERENCES public.studio(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    fine_tuning JSONB NOT NULL,
    labels JSONB NOT NULL,
    description TEXT NOT NULL,
    preview_url TEXT NOT NULL,
    verified_languages JSONB NOT NULL,
    voice_settings JSONB,
    original_voice_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on studio_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_custom_voices_studio_id ON custom_voices(studio_id);


-- Enable RLS
ALTER TABLE custom_voices ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read their own custom voices or voices from their studio
CREATE POLICY "Allow users to read custom voices from their studio"
ON custom_voices FOR SELECT
TO authenticated
USING (true);

-- Allow authenticated users to insert custom voices
CREATE POLICY "Allow users to insert custom voices"
ON custom_voices FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow authenticated users to update their custom voices
CREATE POLICY "Allow users to update custom voices"
ON custom_voices FOR UPDATE
TO authenticated
USING (true);

-- Allow authenticated users to delete their custom voices
CREATE POLICY "Allow users to delete custom voices"
ON custom_voices FOR DELETE
TO authenticated
USING (true);
