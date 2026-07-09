
CREATE OR REPLACE FUNCTION public.increment_conversation_unread(
  _conv_id uuid,
  _window_expires_at timestamptz
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.conversations
     SET unread_count = COALESCE(unread_count, 0) + 1,
         last_message_at = now(),
         last_inbound_at = now(),
         window_expires_at = _window_expires_at,
         status = 'aberto',
         updated_at = now()
   WHERE id = _conv_id;
$$;
