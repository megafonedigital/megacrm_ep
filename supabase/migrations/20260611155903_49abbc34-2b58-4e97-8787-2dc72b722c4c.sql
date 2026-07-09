
CREATE TABLE public.copilot_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Nova conversa',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX copilot_threads_user_brand_idx
  ON public.copilot_threads (user_id, brand_id, last_message_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.copilot_threads TO authenticated;
GRANT ALL ON public.copilot_threads TO service_role;

ALTER TABLE public.copilot_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Copilot threads: owner + role select"
  ON public.copilot_threads FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'supervisor')
      OR public.has_role(auth.uid(), 'developer')
    )
  );

CREATE POLICY "Copilot threads: owner + role insert"
  ON public.copilot_threads FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'supervisor')
      OR public.has_role(auth.uid(), 'developer')
    )
  );

CREATE POLICY "Copilot threads: owner update"
  ON public.copilot_threads FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Copilot threads: owner delete"
  ON public.copilot_threads FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER copilot_threads_set_updated_at
  BEFORE UPDATE ON public.copilot_threads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.copilot_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.copilot_threads(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  parts jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX copilot_messages_thread_created_idx
  ON public.copilot_messages (thread_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.copilot_messages TO authenticated;
GRANT ALL ON public.copilot_messages TO service_role;

ALTER TABLE public.copilot_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Copilot messages: thread owner select"
  ON public.copilot_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.copilot_threads t
      WHERE t.id = thread_id AND t.user_id = auth.uid()
    )
  );

CREATE POLICY "Copilot messages: thread owner insert"
  ON public.copilot_messages FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.copilot_threads t
      WHERE t.id = thread_id AND t.user_id = auth.uid()
    )
  );

CREATE POLICY "Copilot messages: thread owner delete"
  ON public.copilot_messages FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.copilot_threads t
      WHERE t.id = thread_id AND t.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.copilot_touch_thread()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.copilot_threads
     SET last_message_at = now(), updated_at = now()
   WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER copilot_messages_touch_thread
  AFTER INSERT ON public.copilot_messages
  FOR EACH ROW EXECUTE FUNCTION public.copilot_touch_thread();
