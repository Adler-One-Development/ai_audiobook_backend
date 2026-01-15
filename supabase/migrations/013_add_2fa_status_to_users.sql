ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_2fa_enabled boolean DEFAULT false;
