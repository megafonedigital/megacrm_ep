CREATE OR REPLACE FUNCTION public.increment_conversation_unread(
  _conv_id uuid,
  _window_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _prev_status text;
BEGIN
  SELECT status INTO _prev_status FROM public.conversations WHERE id = _conv_id;

  UPDATE public.conversations
     SET unread_count = COALESCE(unread_count, 0) + 1,
         last_message_at = now(),
         last_inbound_at = now(),
         window_expires_at = _window_expires_at,
         status = 'aberto',
         updated_at = now()
   WHERE id = _conv_id;

  IF _prev_status IS NOT NULL AND _prev_status <> 'aberto' THEN
    INSERT INTO public.conversation_events (conversation_id, event_type, actor_id, payload)
    VALUES (
      _conv_id,
      'status_changed',
      NULL,
      jsonb_build_object('from', _prev_status, 'to', 'aberto', 'by', 'inbound_message')
    );
  END IF;
END;
$$;