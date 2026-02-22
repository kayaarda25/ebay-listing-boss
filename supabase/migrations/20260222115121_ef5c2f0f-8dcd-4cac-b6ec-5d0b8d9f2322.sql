
CREATE TABLE public.api_token_cache (
  id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.api_token_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON public.api_token_cache FOR ALL USING (false);
