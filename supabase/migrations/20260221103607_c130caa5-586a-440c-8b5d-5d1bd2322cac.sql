
-- Add pricing settings to sellers table
ALTER TABLE public.sellers 
ADD COLUMN IF NOT EXISTS pricing_settings jsonb NOT NULL DEFAULT '{
  "margin_percent": 20,
  "shipping_cost": 4.99,
  "ebay_fee_percent": 13,
  "paypal_fee_percent": 2.49,
  "paypal_fee_fixed": 0.35,
  "additional_costs": 0,
  "auto_sync_enabled": true,
  "sync_interval_hours": 6
}'::jsonb;

-- Add calculated eBay price to source_products
ALTER TABLE public.source_products
ADD COLUMN IF NOT EXISTS price_ebay numeric DEFAULT NULL;

-- Add last price sync timestamp
ALTER TABLE public.source_products
ADD COLUMN IF NOT EXISTS price_synced_at timestamp with time zone DEFAULT NULL;
