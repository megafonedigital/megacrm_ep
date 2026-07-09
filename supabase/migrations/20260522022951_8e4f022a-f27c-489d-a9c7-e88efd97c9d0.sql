
CREATE OR REPLACE FUNCTION public.merge_conversation_duplicates(keep_id uuid, drop_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  k record;
  d record;
BEGIN
  IF keep_id = drop_id THEN RETURN; END IF;

  SELECT * INTO k FROM conversations WHERE id = keep_id;
  SELECT * INTO d FROM conversations WHERE id = drop_id;
  IF k.id IS NULL OR d.id IS NULL THEN RETURN; END IF;

  -- Move dados associados
  UPDATE messages             SET conversation_id = keep_id WHERE conversation_id = drop_id;
  UPDATE conversation_events  SET conversation_id = keep_id WHERE conversation_id = drop_id;
  UPDATE internal_notes       SET conversation_id = keep_id WHERE conversation_id = drop_id;
  UPDATE automation_runs      SET conversation_id = keep_id WHERE conversation_id = drop_id;

  -- Atualiza metadados da conversa mantida com o mais recente entre as duas
  UPDATE conversations SET
    last_message_at    = GREATEST(COALESCE(k.last_message_at,    'epoch'::timestamptz), COALESCE(d.last_message_at,    'epoch'::timestamptz)),
    last_inbound_at    = GREATEST(COALESCE(k.last_inbound_at,    'epoch'::timestamptz), COALESCE(d.last_inbound_at,    'epoch'::timestamptz)),
    window_expires_at  = GREATEST(COALESCE(k.window_expires_at,  'epoch'::timestamptz), COALESCE(d.window_expires_at,  'epoch'::timestamptz)),
    unread_count       = COALESCE(k.unread_count, 0) + COALESCE(d.unread_count, 0),
    assigned_to        = COALESCE(k.assigned_to, d.assigned_to),
    status             = CASE WHEN k.status = 'aberto' OR d.status = 'aberto' THEN 'aberto'::conversation_status ELSE k.status END,
    updated_at         = now()
  WHERE id = keep_id;

  DELETE FROM conversations WHERE id = drop_id;
END;
$$;

-- Mescla em massa
DO $$
DECLARE
  grp record;
  keep_id uuid;
  drop_id uuid;
BEGIN
  FOR grp IN
    SELECT brand_id, channel_id, contact_id
      FROM conversations
     GROUP BY brand_id, channel_id, contact_id
    HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO keep_id
      FROM conversations
     WHERE brand_id = grp.brand_id AND channel_id = grp.channel_id AND contact_id = grp.contact_id
     ORDER BY last_message_at DESC NULLS LAST, created_at DESC
     LIMIT 1;

    FOR drop_id IN
      SELECT id FROM conversations
       WHERE brand_id = grp.brand_id AND channel_id = grp.channel_id AND contact_id = grp.contact_id
         AND id <> keep_id
    LOOP
      PERFORM public.merge_conversation_duplicates(keep_id, drop_id);
    END LOOP;
  END LOOP;
END $$;

-- Backstop: impede novas duplicatas
CREATE UNIQUE INDEX IF NOT EXISTS conversations_unique_brand_channel_contact
  ON public.conversations (brand_id, channel_id, contact_id);
