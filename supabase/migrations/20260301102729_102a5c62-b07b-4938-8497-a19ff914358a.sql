
-- Reports table for human-readable autopilot activity reports
CREATE TABLE public.autopilot_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id UUID NOT NULL REFERENCES public.sellers(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL DEFAULT 'cycle', -- cycle, daily_summary
  summary TEXT NOT NULL, -- human-readable summary line
  details JSONB NOT NULL DEFAULT '[]'::jsonb, -- array of { icon, text } entries
  stats JSONB NOT NULL DEFAULT '{}'::jsonb, -- { discovered, listed, fulfilled, errors }
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.autopilot_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sellers see own reports" ON public.autopilot_reports
  FOR SELECT USING (seller_id = get_seller_id() OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service insert reports" ON public.autopilot_reports
  FOR INSERT WITH CHECK (true);

-- Index for fast queries
CREATE INDEX idx_autopilot_reports_seller_created ON public.autopilot_reports(seller_id, created_at DESC);
