
ALTER TABLE public.channel_agents
  ADD COLUMN IF NOT EXISTS weight integer NOT NULL DEFAULT 1 CHECK (weight >= 0);

CREATE TABLE IF NOT EXISTS public.channel_agent_rr_state (
  channel_id uuid NOT NULL,
  user_id uuid NOT NULL,
  current_weight integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

ALTER TABLE public.channel_agent_rr_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rr_state_admin_all" ON public.channel_agent_rr_state;
CREATE POLICY "rr_state_admin_all"
  ON public.channel_agent_rr_state
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.pick_next_agent(_channel_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _total_weight integer := 0;
  _winner uuid;
BEGIN
  -- Garante linhas de estado para todos os candidatos elegíveis
  INSERT INTO public.channel_agent_rr_state (channel_id, user_id, current_weight)
  SELECT ca.channel_id, ca.user_id, 0
  FROM public.channel_agents ca
  JOIN public.profiles p ON p.id = ca.user_id AND p.active = true
  WHERE ca.channel_id = _channel_id AND ca.weight > 0
  ON CONFLICT (channel_id, user_id) DO NOTHING;

  -- Soma total de pesos dos candidatos
  SELECT COALESCE(SUM(ca.weight), 0)
  INTO _total_weight
  FROM public.channel_agents ca
  JOIN public.profiles p ON p.id = ca.user_id AND p.active = true
  WHERE ca.channel_id = _channel_id AND ca.weight > 0;

  IF _total_weight = 0 THEN
    RETURN NULL;
  END IF;

  -- Smooth Weighted Round Robin (estilo nginx):
  -- 1) current_weight += weight para cada candidato
  -- 2) escolhe o de maior current_weight
  -- 3) subtrai total_weight do vencedor
  UPDATE public.channel_agent_rr_state s
  SET current_weight = s.current_weight + ca.weight,
      updated_at = now()
  FROM public.channel_agents ca
  JOIN public.profiles p ON p.id = ca.user_id AND p.active = true
  WHERE s.channel_id = _channel_id
    AND s.user_id = ca.user_id
    AND ca.channel_id = _channel_id
    AND ca.weight > 0;

  SELECT s.user_id
  INTO _winner
  FROM public.channel_agent_rr_state s
  JOIN public.channel_agents ca
    ON ca.channel_id = s.channel_id AND ca.user_id = s.user_id
  JOIN public.profiles p ON p.id = s.user_id AND p.active = true
  WHERE s.channel_id = _channel_id AND ca.weight > 0
  ORDER BY s.current_weight DESC, s.user_id ASC
  LIMIT 1;

  IF _winner IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.channel_agent_rr_state
  SET current_weight = current_weight - _total_weight,
      updated_at = now()
  WHERE channel_id = _channel_id AND user_id = _winner;

  -- Mantém round_robin_state populado para retrocompatibilidade/diagnóstico
  INSERT INTO public.round_robin_state (channel_id, last_assigned_user_id, last_assigned_at)
  VALUES (_channel_id, _winner, now())
  ON CONFLICT (channel_id) DO UPDATE
    SET last_assigned_user_id = excluded.last_assigned_user_id,
        last_assigned_at = now();

  RETURN _winner;
END
$function$;
