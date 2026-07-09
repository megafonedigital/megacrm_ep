
-- 1) Resolver papéis duplicados: manter o de maior privilégio (supervisor) e remover o resto.
-- Manualmente: o único caso é 020263b1-bccf-4523-a9b4-8c7e9272be32 que tem (supervisor, agent).
DELETE FROM public.user_roles
WHERE user_id = '020263b1-bccf-4523-a9b4-8c7e9272be32'::uuid
  AND role = 'agent'::app_role;

-- Defensivo: caso surjam outros conflitos no futuro, manter apenas a "melhor" role por usuário
-- segundo a ordem admin > supervisor > agent > developer.
WITH ranked AS (
  SELECT ctid, user_id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id
           ORDER BY CASE role::text
                      WHEN 'admin' THEN 1
                      WHEN 'supervisor' THEN 2
                      WHEN 'agent' THEN 3
                      WHEN 'developer' THEN 4
                      ELSE 5
                    END
         ) AS rn
  FROM public.user_roles
)
DELETE FROM public.user_roles ur
USING ranked
WHERE ur.ctid = ranked.ctid AND ranked.rn > 1;

-- 2) UNIQUE(user_id) em user_roles
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_unique UNIQUE (user_id);

-- 3) has_brand_access: remover ramo brand_members
CREATE OR REPLACE FUNCTION public.has_brand_access(_user_id uuid, _brand_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    public.is_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.brand_channels bc
      JOIN public.channel_agents ca ON ca.channel_id = bc.id
      WHERE bc.brand_id = _brand_id AND ca.user_id = _user_id
    );
$function$;

-- 4) get_user_brands: idem
CREATE OR REPLACE FUNCTION public.get_user_brands(_user_id uuid)
RETURNS TABLE(id uuid, name text, slug text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT b.id, b.name, b.slug
  FROM public.brands b
  WHERE b.active = true
    AND (
      public.is_admin(_user_id)
      OR EXISTS (
        SELECT 1 FROM public.brand_channels bc
        JOIN public.channel_agents ca ON ca.channel_id = bc.id
        WHERE bc.brand_id = b.id AND ca.user_id = _user_id
      )
    )
  ORDER BY b.name;
$function$;

-- 5) Dropar brand_members (e suas policies, via CASCADE) e o enum dedicado
DROP TABLE IF EXISTS public.brand_members CASCADE;
DROP TYPE IF EXISTS public.brand_member_role;
