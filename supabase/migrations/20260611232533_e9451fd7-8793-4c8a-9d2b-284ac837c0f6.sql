
-- Backfill sdk_message_id nulos com o id da linha
UPDATE public.copilot_messages SET sdk_message_id = id::text WHERE sdk_message_id IS NULL;

-- Tornar NOT NULL
ALTER TABLE public.copilot_messages ALTER COLUMN sdk_message_id SET NOT NULL;

-- Trocar índice parcial por constraint única real
DROP INDEX IF EXISTS public.copilot_messages_thread_sdk_uniq;
ALTER TABLE public.copilot_messages
  ADD CONSTRAINT copilot_messages_thread_sdk_uniq UNIQUE (thread_id, sdk_message_id);

-- Adicionar coluna seq para ordenação estável
ALTER TABLE public.copilot_messages ADD COLUMN IF NOT EXISTS seq bigserial;
CREATE INDEX IF NOT EXISTS copilot_messages_thread_seq_idx
  ON public.copilot_messages (thread_id, seq);
