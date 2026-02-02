-- Function to handle new user credits
CREATE OR REPLACE FUNCTION public.handle_new_user_credits()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.credits_allocation (user_id, credits_available)
  VALUES (NEW.id, 10000)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to call the function after a user is inserted
DROP TRIGGER IF EXISTS on_user_created_add_credits ON public.users;

CREATE TRIGGER on_user_created_add_credits
  AFTER INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_credits();
