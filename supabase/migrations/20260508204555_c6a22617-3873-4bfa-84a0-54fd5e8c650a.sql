DROP POLICY IF EXISTS "View runs of accessible brands" ON public.automation_runs;
CREATE POLICY "View runs of accessible brands"
  ON public.automation_runs FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR public.has_brand_access(auth.uid(), brand_id));

DROP POLICY IF EXISTS "View run steps of accessible brands" ON public.automation_run_steps;
CREATE POLICY "View run steps of accessible brands"
  ON public.automation_run_steps FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.automation_runs r
      WHERE r.id = automation_run_steps.run_id
        AND (public.is_admin(auth.uid()) OR public.has_brand_access(auth.uid(), r.brand_id))
    )
  );