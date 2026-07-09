-- 1) Novo claim com cap por janela móvel de 60s por broadcast.
-- Limita itens claimed por broadcast a (rate_per_minute - despachados_no_último_minuto).
-- Evita rajadas (ex: 300/min quando configurado 60/min).
CREATE OR REPLACE FUNCTION public.claim_broadcast_dispatch_queue(_limit integer)
 RETURNS TABLE(id uuid, broadcast_id uuid, target_id uuid, brand_id uuid, automation_id uuid, contact_id uuid, conversation_id uuid, attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH due AS (
    -- Itens elegíveis com remaining budget calculado por broadcast.
    SELECT
      q.id,
      q.broadcast_id,
      q.scheduled_send_at,
      q.created_at,
      b.rate_per_minute,
      GREATEST(
        0,
        b.rate_per_minute - COALESCE(
          (SELECT count(*)::int
             FROM public.broadcast_targets t
            WHERE t.broadcast_id = b.id
              AND t.dispatched_at >= now() - interval '1 minute'),
          0
        )
      ) AS budget_remaining
    FROM public.broadcast_dispatch_queue q
    JOIN public.broadcasts b ON b.id = q.broadcast_id
    WHERE q.status = 'pending'
      AND q.next_attempt_at <= now()
      AND q.scheduled_send_at <= now()
      AND b.status = 'running'
  ), ranked AS (
    -- Numera itens por broadcast em ordem cronológica.
    SELECT
      d.id,
      d.broadcast_id,
      d.budget_remaining,
      row_number() OVER (PARTITION BY d.broadcast_id ORDER BY d.scheduled_send_at, d.created_at) AS rn
    FROM due d
  ), eligible AS (
    -- Mantém somente até budget_remaining por broadcast.
    SELECT id FROM ranked WHERE rn <= budget_remaining
    LIMIT GREATEST(_limit, 0)
  ), picked AS (
    SELECT q.id
      FROM public.broadcast_dispatch_queue q
     WHERE q.id IN (SELECT id FROM eligible)
     ORDER BY q.scheduled_send_at, q.created_at
     FOR UPDATE OF q SKIP LOCKED
  )
  UPDATE public.broadcast_dispatch_queue q
     SET status = 'processing',
         claimed_at = now(),
         attempts = q.attempts + 1,
         updated_at = now()
    FROM picked
   WHERE q.id = picked.id
   RETURNING q.id, q.broadcast_id, q.target_id, q.brand_id, q.automation_id, q.contact_id, q.conversation_id, q.attempts;
END;
$function$;

-- 2) RPC auxiliar para o drain dimensionar workers dinamicamente.
-- Retorna soma de rate_per_minute dos broadcasts em execução.
CREATE OR REPLACE FUNCTION public.get_running_broadcasts_rate_sum()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(rate_per_minute), 0)::int
    FROM public.broadcasts
   WHERE status = 'running';
$function$;

GRANT EXECUTE ON FUNCTION public.get_running_broadcasts_rate_sum() TO authenticated, service_role;

-- 3) Índice para acelerar o cálculo de budget_remaining (count por broadcast no último minuto).
CREATE INDEX IF NOT EXISTS broadcast_targets_broadcast_dispatched_idx
  ON public.broadcast_targets (broadcast_id, dispatched_at DESC)
  WHERE dispatched_at IS NOT NULL;

-- 4) Cleanup agressivo de órfãos atuais (one-shot via versão temporária do requeue).
UPDATE public.broadcast_dispatch_queue q
   SET status = 'pending',
       claimed_at = NULL,
       next_attempt_at = now(),
       scheduled_send_at = LEAST(COALESCE(q.scheduled_send_at, now()), now()),
       updated_at = now(),
       last_error = COALESCE(last_error, 'Cleanup: drain interrompido antes de finalizar')
 WHERE q.status = 'processing'
   AND q.claimed_at < now() - interval '2 minutes'
   AND NOT EXISTS (
     SELECT 1
       FROM public.broadcast_targets t
      WHERE t.id = q.target_id
        AND t.run_id IS NOT NULL
   );

UPDATE public.broadcast_targets t
   SET status = 'pending',
       claimed_at = NULL
 WHERE t.status = 'processing'
   AND t.run_id IS NULL
   AND (t.claimed_at IS NULL OR t.claimed_at < now() - interval '2 minutes')
   AND NOT EXISTS (
     SELECT 1
       FROM public.broadcast_dispatch_queue q
      WHERE q.target_id = t.id
        AND q.status IN ('pending', 'processing')
   );