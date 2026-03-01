-- Remove unique constraint on user_id to allow multiple stores per user
ALTER TABLE public.sellers DROP CONSTRAINT sellers_user_id_key;

-- Add a unique constraint on (user_id, ebay_user_id) instead to prevent duplicates
ALTER TABLE public.sellers ADD CONSTRAINT sellers_user_id_ebay_user_id_key UNIQUE (user_id, ebay_user_id);