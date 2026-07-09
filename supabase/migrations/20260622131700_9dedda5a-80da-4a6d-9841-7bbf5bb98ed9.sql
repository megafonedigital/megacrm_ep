-- Token bucket controller for broadcast dispatch pacing.
-- Substitui janela fixa de 60s + penalidade de processing por refill contínuo.

CREATE TABLE IF NOT EXISTS public.broadcast_rate_state (
  broadcast_id uuid PRIMARY KEY REFERENCES public.broadcasts(id) ON DELETE CASCADE,
  tokens numeric NOT NULL DEFAULT 0,
  last_refill_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.broadcast_rate_state TO authenticated;
GRANT ALL ON public.broadcast_rate_state TO service_role;

ALTER TABLE public.broadcast_rate_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rate_state_admin_read" ON public.broadcast_rate_state
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Nova versão do claim usando token bucket.
-- Refill contínuo: tokens += elapsed_seconds * (rate_per_minute / 60)
-- Burst cap: rate_per_minute / 6  (~10s de capacidade, evita rajadas grandes)
-- Não desconta itens em processing — sucesso/falha é o que efetivamente consome o token.
CREATE OR REPLACE FUNCTION public.claim_broadcast_dispatch_queue(_limit integer)
RETURNS TABLE(id uuid, broadcast_id uuid, target_id uuid, brand_id uuid, automation_id uuid, contact_id uuid, conversation_id uuid, attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- 1) Garante linha em broadcast_rate_state para todo broadcast running.
  INSERT INTO public.broadcast_rate_state (broadcast_id, tokens, last_refill_at)
  SELECT b.id, 0, now()
    FROM public.broadcasts b
   WHERE b.status = 'running'
  ON CONFLICT (broadcast_id) DO NOTHING;

  -- 2) Refill contínuo + cálculo do budget disponível por broadcast (com lock por linha).
  RETURN QUERY
  WITH
  refilled AS (
    UPDATE public.broadcast_rate_state s
       SET tokens = LEAST(
             GREATEST(b.rate_per_minute, 1)::numeric / 6.0,  -- burst cap ~10s
             s.tokens + EXTRACT(EPOCH FROM (now() - s.last_refill_at))
                        * (GREATEST(b.rate_per_minute, 1)::numeric / 60.0)
           ),
           last_refill_at = now(),
           updated_at = now()
      FROM public.broadcasts b
     WHERE b.id = s.broadcast_id
       AND b.status = 'running'
    RETURNING s.broadcast_id, FLOOR(s.tokens)::int AS budget_remaining
  ),
  eligible AS (
    SELECT q.id AS queue_id,
           q.broadcast_id,
           row_number() OVER (PARTITION BY q.broadcast_id ORDER BY q.scheduled_send_at, q.created_at) AS rn
      FROM public.broadcast_dispatch_queue q
      JOIN refilled r ON r.broadcast_id = q.broadcast_id
     WHERE q.status = 'pending'
       AND q.next_attempt_at <= now()
       AND q.scheduled_send_at <= now()
       AND r.budget_remaining > 0
  ),
  capped AS (
    SELECT e.queue_id, e.broadcast_id
      FROM eligible e
      JOIN refilled r ON r.broadcast_id = e.broadcast_id
     WHERE e.rn <= r.budget_remaining
     ORDER BY e.rn, e.queue_id
     LIMIT GREATEST(_limit, 0)
  ),
  picked AS (
    SELECT q.id AS queue_id, q.broadcast_id
      FROM public.broadcast_dispatch_queue q
      JOIN capped c ON c.queue_id = q.id
     WHERE q.status = 'pending'
     FOR UPDATE OF q SKIP LOCKED
  ),
  consumed AS (
    -- Desconta 1 token por item efetivamente picked.
    UPDATE public.broadcast_rate_state s
       SET tokens = GREATEST(0, s.tokens - cnt.n),
           updated_at = now()
      FROM (
        SELECT p.broadcast_id, COUNT(*)::numeric AS n
          FROM picked p
         GROUP BY p.broadcast_id
      ) cnt
     WHERE s.broadcast_id = cnt.broadcast_id
    RETURNING s.broadcast_id
  ),
  updated AS (
    UPDATE public.broadcast_dispatch_queue q
       SET status = 'processing',
           claimed_at = now(),
           attempts = q.attempts + 1,
           updated_at = now()
      FROM picked p
     WHERE q.id = p.queue_id
    RETURNING q.id, q.broadcast_id, q.target_id, q.brand_id, q.automation_id, q.contact_id, q.conversation_id, q.attempts
  )
  SELECT u.id, u.broadcast_id, u.target_id, u.brand_id, u.automation_id, u.contact_id, u.conversation_id, u.attempts
    FROM updated u
   WHERE (SELECT COUNT(*) FROM consumed) >= 0;  -- força avaliação do CTE consumed
END;
$function$;