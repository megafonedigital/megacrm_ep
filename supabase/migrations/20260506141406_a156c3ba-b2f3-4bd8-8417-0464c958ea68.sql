
ALTER TABLE public.brand_channels
  ADD COLUMN IF NOT EXISTS round_robin_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS offhours_message text;

CREATE TABLE IF NOT EXISTS public.channel_agents (
  channel_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);
ALTER TABLE public.channel_agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS channel_agents_admin_all ON public.channel_agents;
CREATE POLICY channel_agents_admin_all ON public.channel_agents
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS channel_agents_select_self ON public.channel_agents;
CREATE POLICY channel_agents_select_self ON public.channel_agents
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

UPDATE public.brand_channels bc
SET round_robin_enabled = COALESCE(t.round_robin_enabled, false),
    offhours_message = t.offhours_message
FROM public.teams t
WHERE t.channel_id = bc.id;

INSERT INTO public.channel_agents (channel_id, user_id)
SELECT DISTINCT t.channel_id, at.user_id
FROM public.agent_teams at
JOIN public.teams t ON t.id = at.team_id
WHERE t.channel_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.channel_agents (channel_id, user_id)
SELECT DISTINCT bc.id, ab.user_id
FROM public.agent_brands ab
JOIN public.brand_channels bc ON bc.brand_id = ab.brand_id
ON CONFLICT DO NOTHING;

UPDATE public.conversations c
SET channel_id = t.channel_id
FROM public.teams t
WHERE c.team_id = t.id
  AND c.channel_id IS NULL
  AND t.channel_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.create_default_channel_team() CASCADE;

CREATE OR REPLACE FUNCTION public.has_brand_access(_user_id uuid, _brand_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.brand_channels bc
      JOIN public.channel_agents ca ON ca.channel_id = bc.id
      WHERE bc.brand_id = _brand_id AND ca.user_id = _user_id
    );
$$;

ALTER TABLE public.round_robin_state ADD COLUMN IF NOT EXISTS channel_id uuid;

UPDATE public.round_robin_state rs
SET channel_id = t.channel_id
FROM public.teams t
WHERE rs.team_id = t.id AND rs.channel_id IS NULL;

DELETE FROM public.round_robin_state WHERE channel_id IS NULL;

ALTER TABLE public.round_robin_state DROP CONSTRAINT IF EXISTS round_robin_state_pkey;
ALTER TABLE public.round_robin_state DROP COLUMN IF EXISTS team_id;
ALTER TABLE public.round_robin_state ALTER COLUMN channel_id SET NOT NULL;
ALTER TABLE public.round_robin_state ADD PRIMARY KEY (channel_id);

DROP FUNCTION IF EXISTS public.pick_next_agent(uuid);

CREATE OR REPLACE FUNCTION public.pick_next_agent(_channel_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _last uuid; _next uuid;
BEGIN
  SELECT last_assigned_user_id INTO _last FROM public.round_robin_state WHERE channel_id = _channel_id;
  WITH candidates AS (
    SELECT DISTINCT p.id AS user_id
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'agent'
    JOIN public.agent_presence ap ON ap.user_id = p.id AND ap.status = 'online'
    JOIN public.channel_agents ca ON ca.user_id = p.id AND ca.channel_id = _channel_id
    WHERE p.active = true ORDER BY p.id
  )
  SELECT user_id INTO _next FROM candidates
  WHERE _last IS NULL OR user_id > _last ORDER BY user_id LIMIT 1;

  IF _next IS NULL THEN
    SELECT user_id INTO _next FROM (
      SELECT DISTINCT p.id AS user_id
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'agent'
      JOIN public.agent_presence ap ON ap.user_id = p.id AND ap.status = 'online'
      JOIN public.channel_agents ca ON ca.user_id = p.id AND ca.channel_id = _channel_id
      WHERE p.active = true ORDER BY p.id
    ) c LIMIT 1;
  END IF;

  IF _next IS NOT NULL THEN
    INSERT INTO public.round_robin_state (channel_id, last_assigned_user_id, last_assigned_at)
    VALUES (_channel_id, _next, now())
    ON CONFLICT (channel_id) DO UPDATE SET last_assigned_user_id = excluded.last_assigned_user_id, last_assigned_at = now();
  END IF;
  RETURN _next;
END $$;

DROP FUNCTION IF EXISTS public.is_in_team(uuid, uuid);

ALTER TABLE public.conversations ALTER COLUMN team_id DROP NOT NULL;
ALTER TABLE public.conversations DROP COLUMN IF EXISTS team_id;

DROP TABLE IF EXISTS public.agent_teams CASCADE;
DROP TABLE IF EXISTS public.agent_brands CASCADE;
DROP TABLE IF EXISTS public.teams CASCADE;

UPDATE public.conversations SET channel_id = (
  SELECT id FROM public.brand_channels bc WHERE bc.brand_id = conversations.brand_id LIMIT 1
) WHERE channel_id IS NULL;
ALTER TABLE public.conversations ALTER COLUMN channel_id SET NOT NULL;
