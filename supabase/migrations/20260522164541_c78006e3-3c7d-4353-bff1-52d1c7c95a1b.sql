CREATE POLICY "brand_members_select_workspace"
ON public.brand_members FOR SELECT TO authenticated
USING (public.has_brand_access(auth.uid(), brand_id));

CREATE POLICY "channel_agents_select_workspace"
ON public.channel_agents FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.brand_channels bc
    WHERE bc.id = channel_agents.channel_id
      AND public.has_brand_access(auth.uid(), bc.brand_id)
  )
);