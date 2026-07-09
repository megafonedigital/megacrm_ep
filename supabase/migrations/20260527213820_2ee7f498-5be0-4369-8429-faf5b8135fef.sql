CREATE OR REPLACE FUNCTION public.touch_conversation_last_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.conversations
     SET last_message_at = GREATEST(COALESCE(last_message_at, 'epoch'::timestamptz), NEW.created_at),
         updated_at      = now()
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_touch_conversation ON public.messages;
CREATE TRIGGER trg_messages_touch_conversation
AFTER INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.touch_conversation_last_message();

UPDATE public.conversations c
   SET last_message_at = sub.max_created
  FROM (
    SELECT conversation_id, MAX(created_at) AS max_created
      FROM public.messages
     GROUP BY conversation_id
  ) sub
 WHERE sub.conversation_id = c.id
   AND (c.last_message_at IS NULL OR sub.max_created > c.last_message_at);