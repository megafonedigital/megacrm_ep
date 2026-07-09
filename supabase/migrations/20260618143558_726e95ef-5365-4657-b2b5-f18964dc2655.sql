CREATE INDEX IF NOT EXISTS automation_node_messages_wa_message_id_idx
  ON public.automation_node_messages (wa_message_id)
  WHERE wa_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS automation_node_messages_run_node_idx
  ON public.automation_node_messages (run_id, node_id)
  WHERE wa_message_id IS NOT NULL;