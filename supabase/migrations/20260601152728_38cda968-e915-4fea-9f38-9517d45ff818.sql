CREATE TABLE public.automation_node_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL,
  automation_id uuid NOT NULL,
  run_id uuid,
  node_id text NOT NULL,
  node_type text NOT NULL,
  contact_id uuid,
  conversation_id uuid,
  channel_id uuid,
  wa_message_id text UNIQUE,
  template_name text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  replied_at timestamptz,
  button_clicked_at timestamptz,
  button_payload jsonb,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.automation_node_messages TO authenticated;
GRANT ALL ON public.automation_node_messages TO service_role;

ALTER TABLE public.automation_node_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anm_select_member" ON public.automation_node_messages
  FOR SELECT TO authenticated
  USING (is_admin(auth.uid()) OR has_brand_access(auth.uid(), brand_id));

CREATE INDEX idx_anm_automation_sent ON public.automation_node_messages (automation_id, sent_at DESC);
CREATE INDEX idx_anm_wa_message ON public.automation_node_messages (wa_message_id);
CREATE INDEX idx_anm_run_node ON public.automation_node_messages (run_id, node_id);
CREATE INDEX idx_anm_conv_sent ON public.automation_node_messages (conversation_id, sent_at DESC);