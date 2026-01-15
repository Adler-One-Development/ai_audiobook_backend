-- Seed default credits pricing
INSERT INTO public.credits_pricing (price_per_credit)
SELECT 1.0
WHERE NOT EXISTS (SELECT 1 FROM public.credits_pricing);
