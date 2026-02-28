
-- API Keys table for external agent authentication
CREATE TABLE public.api_keys (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  seller_id uuid NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- Only service role can access api_keys (used by edge functions)
CREATE POLICY "Service role only" ON public.api_keys FOR ALL USING (false);

-- SKU Mapping table: maps eBay SKUs to CJ variant IDs
CREATE TABLE public.sku_map (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id uuid NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  ebay_sku text NOT NULL,
  cj_variant_id text NOT NULL,
  supplier text NOT NULL DEFAULT 'cj',
  default_qty integer NOT NULL DEFAULT 1,
  min_margin_pct numeric NOT NULL DEFAULT 20,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(seller_id, ebay_sku)
);

ALTER TABLE public.sku_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON public.sku_map FOR ALL USING (false);

CREATE TRIGGER update_sku_map_updated_at
  BEFORE UPDATE ON public.sku_map
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Jobs table for async task processing
CREATE TABLE public.jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id uuid NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  type text NOT NULL,
  state text NOT NULL DEFAULT 'queued',
  input jsonb DEFAULT '{}'::jsonb,
  output jsonb,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  run_after timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON public.jobs FOR ALL USING (false);

CREATE TRIGGER update_jobs_updated_at
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_jobs_state_run_after ON public.jobs (state, run_after) WHERE state IN ('queued', 'running');

-- API Audit Log
CREATE TABLE public.api_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  api_key_id uuid REFERENCES public.api_keys(id) ON DELETE SET NULL,
  seller_id uuid REFERENCES public.sellers(id) ON DELETE SET NULL,
  method text NOT NULL,
  path text NOT NULL,
  status_code integer,
  duration_ms integer,
  ip text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.api_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON public.api_audit_log FOR ALL USING (false);

CREATE INDEX idx_api_audit_log_created ON public.api_audit_log (created_at DESC);

-- Rate limiting tracking
CREATE TABLE public.api_rate_limits (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  api_key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  window_start timestamp with time zone NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  UNIQUE(api_key_id, window_start)
);

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON public.api_rate_limits FOR ALL USING (false);
