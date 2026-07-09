CREATE POLICY "Copilot messages: thread owner update"
  ON public.copilot_messages FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.copilot_threads t
      WHERE t.id = thread_id AND t.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.copilot_threads t
      WHERE t.id = thread_id AND t.user_id = auth.uid()
    )
  );