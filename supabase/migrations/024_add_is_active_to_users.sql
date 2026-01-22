-- Add is_active column to users table for user status management
-- Default is TRUE (active) for all users

ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Add index for performance when querying active/inactive users
CREATE INDEX IF NOT EXISTS idx_users_is_active ON public.users(is_active);

-- Add comment to document the column
COMMENT ON COLUMN public.users.is_active IS 'Indicates if user account is active. Inactive users cannot login.';
