
-- Membership de workspace (Expert)
CREATE TYPE public.brand_member_role AS ENUM ('admin', 'member');

CREATE TABLE public.brand_members (
  brand_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role public.brand_member_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand_id, user_id)
);

CREATE INDEX idx_brand_members_user ON public.brand_members(user_id);

ALTER TABLE public.brand_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY brand_members_admin_all ON public.brand_members
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY brand_members_select_self ON public.brand_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Atualiza has_brand_access para incluir membership de workspace
CREATE OR REPLACE FUNCTION public.has_brand_access(_user_id uuid, _brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.brand_members bm
      WHERE bm.brand_id = _brand_id AND bm.user_id = _user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.brand_channels bc
      JOIN public.channel_agents ca ON ca.channel_id = bc.id
      WHERE bc.brand_id = _brand_id AND ca.user_id = _user_id
    );
$$;

-- Lista Experts visíveis a um usuário
CREATE OR REPLACE FUNCTION public.get_user_brands(_user_id uuid)
RETURNS TABLE(id uuid, name text, slug text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.name, b.slug
  FROM public.brands b
  WHERE b.active = true
    AND (
      public.is_admin(_user_id)
      OR EXISTS (SELECT 1 FROM public.brand_members bm WHERE bm.brand_id = b.id AND bm.user_id = _user_id)
      OR EXISTS (
        SELECT 1 FROM public.brand_channels bc
        JOIN public.channel_agents ca ON ca.channel_id = bc.id
        WHERE bc.brand_id = b.id AND ca.user_id = _user_id
      )
    )
  ORDER BY b.name;
$$;
