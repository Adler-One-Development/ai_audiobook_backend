-- Drop the old industry TEXT column as we now use industry_id
ALTER TABLE public.users DROP COLUMN IF EXISTS industry;
