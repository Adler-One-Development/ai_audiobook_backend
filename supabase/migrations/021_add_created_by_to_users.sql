-- Add created_by column to users table
ALTER TABLE public.users 
ADD COLUMN created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_users_created_by ON public.users(created_by);

-- Add comment to explain the column
COMMENT ON COLUMN public.users.created_by IS 'UUID of the user who created this user account';
