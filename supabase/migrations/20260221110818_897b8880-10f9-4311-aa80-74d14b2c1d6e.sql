
-- Add variants support to source_products
ALTER TABLE public.source_products 
ADD COLUMN IF NOT EXISTS variants_json jsonb DEFAULT '[]'::jsonb;

-- Comment for clarity
COMMENT ON COLUMN public.source_products.variants_json IS 'Array of variant objects: [{name, values: [{value, price_source, stock, source_id}]}]';
