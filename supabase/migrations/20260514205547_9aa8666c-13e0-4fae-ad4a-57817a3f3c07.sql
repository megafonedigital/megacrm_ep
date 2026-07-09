
-- Developer role: workspace-scoped admin powers via parallel RLS policies

-- brand_channels
CREATE POLICY "brand_channels_developer_all"
ON public.brand_channels FOR ALL TO authenticated
USING (has_role(auth.uid(), 'developer'::app_role) AND has_brand_access(auth.uid(), brand_id))
WITH CHECK (has_role(auth.uid(), 'developer'::app_role) AND has_brand_access(auth.uid(), brand_id));

-- whatsapp_templates
CREATE POLICY "templates_developer_all"
ON public.whatsapp_templates FOR ALL TO authenticated
USING (has_role(auth.uid(), 'developer'::app_role) AND has_brand_access(auth.uid(), brand_id))
WITH CHECK (has_role(auth.uid(), 'developer'::app_role) AND has_brand_access(auth.uid(), brand_id));

-- channel_agents
CREATE POLICY "channel_agents_developer_all"
ON public.channel_agents FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'developer'::app_role) AND EXISTS (
    SELECT 1 FROM public.brand_channels bc
    WHERE bc.id = channel_agents.channel_id AND has_brand_access(auth.uid(), bc.brand_id)
  )
)
WITH CHECK (
  has_role(auth.uid(), 'developer'::app_role) AND EXISTS (
    SELECT 1 FROM public.brand_channels bc
    WHERE bc.id = channel_agents.channel_id AND has_brand_access(auth.uid(), bc.brand_id)
  )
);

-- channel_agent_rr_state
CREATE POLICY "rr_state_developer_all"
ON public.channel_agent_rr_state FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'developer'::app_role) AND EXISTS (
    SELECT 1 FROM public.brand_channels bc
    WHERE bc.id = channel_agent_rr_state.channel_id AND has_brand_access(auth.uid(), bc.brand_id)
  )
)
WITH CHECK (
  has_role(auth.uid(), 'developer'::app_role) AND EXISTS (
    SELECT 1 FROM public.brand_channels bc
    WHERE bc.id = channel_agent_rr_state.channel_id AND has_brand_access(auth.uid(), bc.brand_id)
  )
);

-- brand_members
CREATE POLICY "brand_members_developer_all"
ON public.brand_members FOR ALL TO authenticated
USING (has_role(auth.uid(), 'developer'::app_role) AND has_brand_access(auth.uid(), brand_id))
WITH CHECK (has_role(auth.uid(), 'developer'::app_role) AND has_brand_access(auth.uid(), brand_id));

-- brand_api_keys
CREATE POLICY "brand_api_keys_developer_all"
ON public.brand_api_keys FOR ALL TO authenticated
USING (has_role(auth.uid(), 'developer'::app_role) AND has_brand_access(auth.uid(), brand_id))
WITH CHECK (has_role(auth.uid(), 'developer'::app_role) AND has_brand_access(auth.uid(), brand_id));

-- automations: developer manage
CREATE POLICY "automations_developer_all"
ON public.automations FOR ALL TO authenticated
USING (has_role(auth.uid(), 'developer'::app_role) AND has_brand_access(auth.uid(), brand_id))
WITH CHECK (has_role(auth.uid(), 'developer'::app_role) AND has_brand_access(auth.uid(), brand_id));

-- pipelines: developer write
CREATE POLICY "pipelines_developer_write"
ON public.pipelines FOR ALL TO authenticated
USING (has_role(auth.uid(), 'developer'::app_role) AND has_brand_access(auth.uid(), brand_id))
WITH CHECK (has_role(auth.uid(), 'developer'::app_role) AND has_brand_access(auth.uid(), brand_id));

-- pipeline_stages: developer write
CREATE POLICY "pipeline_stages_developer_write"
ON public.pipeline_stages FOR ALL TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.pipelines p
  WHERE p.id = pipeline_stages.pipeline_id
    AND has_role(auth.uid(), 'developer'::app_role)
    AND has_brand_access(auth.uid(), p.brand_id)
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.pipelines p
  WHERE p.id = pipeline_stages.pipeline_id
    AND has_role(auth.uid(), 'developer'::app_role)
    AND has_brand_access(auth.uid(), p.brand_id)
));

-- integration_account_brands: developer select for brands they access
CREATE POLICY "iab_developer_select"
ON public.integration_account_brands FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'developer'::app_role) AND has_brand_access(auth.uid(), brand_id));

-- integration_accounts: developer can see accounts linked to their brands
CREATE POLICY "integration_accounts_developer_select"
ON public.integration_accounts FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'developer'::app_role) AND EXISTS (
    SELECT 1 FROM public.integration_account_brands iab
    WHERE iab.account_id = integration_accounts.id
      AND has_brand_access(auth.uid(), iab.brand_id)
  )
);

-- error_logs: developer can view errors of their brands
CREATE POLICY "error_logs_developer_select"
ON public.error_logs FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'developer'::app_role)
  AND brand_id IS NOT NULL
  AND has_brand_access(auth.uid(), brand_id)
);
