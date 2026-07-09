
-- 1) Helper: brand IDs accessible to a user via their channels
CREATE OR REPLACE FUNCTION public.accessible_brand_ids(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT bc.brand_id
  FROM public.brand_channels bc
  JOIN public.channel_agents ca ON ca.channel_id = bc.id
  WHERE ca.user_id = _user_id;
$$;

GRANT EXECUTE ON FUNCTION public.accessible_brand_ids(uuid) TO authenticated, service_role;

-- 2) SELECT policy: InitPlan-friendly (scalar fns wrapped in SELECT; set-returning fn via IN)
DROP POLICY IF EXISTS conversations_select ON public.conversations;
CREATE POLICY conversations_select ON public.conversations
FOR SELECT
USING (
  (SELECT public.is_admin((SELECT auth.uid())))
  OR (SELECT public.has_role((SELECT auth.uid()), 'developer'::app_role))
  OR (
    brand_id IN (SELECT public.accessible_brand_ids((SELECT auth.uid())))
    AND (
      (SELECT public.has_role((SELECT auth.uid()), 'supervisor'::app_role))
      OR assigned_to = (SELECT auth.uid())
      OR assigned_to IS NULL
    )
  )
);

-- 3) UPDATE policy: same optimization, preserves prior semantics
DROP POLICY IF EXISTS conversations_update ON public.conversations;
CREATE POLICY conversations_update ON public.conversations
FOR UPDATE
USING (
  (SELECT public.is_admin((SELECT auth.uid())))
  OR (SELECT public.has_role((SELECT auth.uid()), 'developer'::app_role))
  OR (
    brand_id IN (SELECT public.accessible_brand_ids((SELECT auth.uid())))
    AND (
      (SELECT public.has_role((SELECT auth.uid()), 'supervisor'::app_role))
      OR assigned_to = (SELECT auth.uid())
      OR assigned_to IS NULL
    )
  )
)
WITH CHECK (
  (SELECT public.is_admin((SELECT auth.uid())))
  OR (SELECT public.has_role((SELECT auth.uid()), 'developer'::app_role))
  OR (
    brand_id IN (SELECT public.accessible_brand_ids((SELECT auth.uid())))
  )
);
