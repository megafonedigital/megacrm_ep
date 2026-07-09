-- Limpa itens da fila do broadcast eb020b2a-07df-45dd-a454-4b4397b73af2 que ficaram
-- travados em "processing" sem run_id e zera tentativas para reprocessamento limpo.
UPDATE public.broadcast_dispatch_queue q
   SET status = 'pending',
       claimed_at = NULL,
       attempts = 0,
       next_attempt_at = now(),
       scheduled_send_at = now(),
       last_error = NULL,
       updated_at = now()
 WHERE q.broadcast_id = 'eb020b2a-07df-45dd-a454-4b4397b73af2'
   AND q.status IN ('pending', 'processing')
   AND NOT EXISTS (
     SELECT 1 FROM public.broadcast_targets t
      WHERE t.id = q.target_id AND t.run_id IS NOT NULL
   );

-- Também devolve os targets correspondentes a "pending"
UPDATE public.broadcast_targets t
   SET status = 'pending',
       claimed_at = NULL,
       error = NULL
 WHERE t.broadcast_id = 'eb020b2a-07df-45dd-a454-4b4397b73af2'
   AND t.status = 'processing'
   AND t.run_id IS NULL;