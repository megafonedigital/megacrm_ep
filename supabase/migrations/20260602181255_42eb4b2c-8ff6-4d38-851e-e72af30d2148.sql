CREATE OR REPLACE FUNCTION public.reopen_conversation_on_outbound(
  _conv_id uuid,
  _actor_id uuid,
  _by text
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
     SET last_message_at = now(),
         status = 'aberto',
         updated_at = now()
   WHERE id = _conv_id;

  IF _prev_status IS NOT NULL AND _prev_status <> 'aberto' THEN
    INSERT INTO public.conversation_events (conversation_id, event_type, actor_id, payload)
    VALUES (
      _conv_id,
      'status_changed',
      _actor_id,
      jsonb_build_object('from', _prev_status, 'to', 'aberto', 'by', COALESCE(_by, 'outbound_message'))
    );
  END IF;
END;
$$;