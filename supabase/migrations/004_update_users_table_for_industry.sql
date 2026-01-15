-- Update users table to reference industries by ID instead of text

-- Add industry_id column
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS industry_id UUID REFERENCES public.industries(id) ON DELETE SET NULL;

-- Create index on industry_id for faster joins
CREATE INDEX IF NOT EXISTS idx_users_industry_id ON public.users(industry_id);

-- Migrate existing industry data (if any) - this will be NULL for now since it was text before
-- The old 'industry' column can be dropped after data migration if needed
-- For now, we'll keep both columns for backward compatibility during transition

-- Note: The old 'industry' TEXT column still exists but new data will use industry_id
-- To fully migrate, you would:
-- 1. Map existing industry text values to industry IDs
-- 2. Update industry_id column
-- 3. Drop industry column
-- For this implementation, we'll use industry_id going forward
