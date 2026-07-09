DROP POLICY IF EXISTS profiles_select_authenticated ON public.profiles;

CREATE POLICY profiles_select_scoped
ON public.profiles
FOR SELECT
TO authenticated
USING (
  id = auth.uid()
  OR public.is_admin(auth.uid())
  OR public.has_role(auth.uid(), 'supervisor'::app_role)
  OR public.has_role(auth.uid(), 'developer'::app_role)
  OR EXISTS (
    SELECT 1
    FROM public.accessible_brand_ids(auth.uid()) AS mine(brand_id)
    JOIN public.accessible_brand_ids(profiles.id) AS theirs(brand_id)
      ON mine.brand_id = theirs.brand_id
  )
);