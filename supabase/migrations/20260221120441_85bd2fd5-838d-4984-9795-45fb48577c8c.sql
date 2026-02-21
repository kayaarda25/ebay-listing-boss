
-- Add Amazon credentials columns to sellers table
ALTER TABLE public.sellers 
ADD COLUMN amazon_email text,
ADD COLUMN amazon_password_enc text;

-- Add a comment for clarity
COMMENT ON COLUMN public.sellers.amazon_password_enc IS 'Encrypted Amazon password - never store plaintext';
