
ALTER TABLE public.ebay_offers ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.ebay_offers ADD COLUMN IF NOT EXISTS source_url text;
