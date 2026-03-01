
-- Tighten INSERT policy: only service role can insert reports
DROP POLICY "Service insert reports" ON public.autopilot_reports;
