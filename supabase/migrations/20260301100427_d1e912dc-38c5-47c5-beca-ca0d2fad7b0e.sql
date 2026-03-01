
ALTER TABLE public.source_products
ADD CONSTRAINT source_products_seller_id_source_id_key UNIQUE (seller_id, source_id);
