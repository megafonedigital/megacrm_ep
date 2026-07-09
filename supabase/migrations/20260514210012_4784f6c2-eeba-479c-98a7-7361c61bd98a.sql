CREATE POLICY "api_request_logs_developer_select"
ON public.api_request_logs FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'developer'::app_role)
  AND brand_id IS NOT NULL
  AND has_brand_access(auth.uid(), brand_id)
);