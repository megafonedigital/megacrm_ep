
-- Separar identificadores por canal: WhatsApp (wa_id) e Webchat (webchat_visitor_id)

-- 1) Nova coluna nullable para o identificador do visitante do Webchat
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS webchat_visitor_id text;

-- 2) Tornar wa_id opcional (deixa de ser exclusivo do WhatsApp obrigatório)
ALTER TABLE public.contacts
  ALTER COLUMN wa_id DROP NOT NULL;

-- 3) Substituir o índice único antigo por um índice único parcial (só quando wa_id existe)
ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS contacts_brand_id_wa_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_brand_wa_id_uniq
  ON public.contacts (brand_id, wa_id)
  WHERE wa_id IS NOT NULL;

-- 4) Índice único parcial para o identificador do Webchat
CREATE UNIQUE INDEX IF NOT EXISTS contacts_brand_webchat_visitor_uniq
  ON public.contacts (brand_id, webchat_visitor_id)
  WHERE webchat_visitor_id IS NOT NULL;

-- 5) Garantir que todo contato tenha pelo menos um identificador de canal
ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS contacts_channel_identifier_present;

ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_channel_identifier_present
  CHECK (wa_id IS NOT NULL OR webchat_visitor_id IS NOT NULL);

-- 6) Atualizar a RPC do Webchat para usar a nova coluna (sem tocar em wa_id)
CREATE OR REPLACE FUNCTION public.webchat_start_session(
  p_widget_id uuid,
  p_visitor_id text,
  p_name text,
  p_email text,
  p_user_agent text DEFAULT NULL::text,
  p_ip text DEFAULT NULL::text,
  p_page_url text DEFAULT NULL::text
)
RETURNS TABLE(session_id uuid, session_token text, conversation_id uuid, contact_id uuid, is_new boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_widget       public.webchat_widgets%ROWTYPE;
  v_channel_id   uuid;
  v_brand_id     uuid;
  v_contact_id   uuid;
  v_conv_id      uuid;
  v_session      public.webchat_sessions%ROWTYPE;
  v_assignee     uuid;
  v_is_new       boolean := false;
BEGIN
  SELECT * INTO v_widget FROM public.webchat_widgets WHERE id = p_widget_id AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'widget_not_found';
  END IF;
  v_channel_id := v_widget.channel_id;
  v_brand_id   := v_widget.brand_id;

  SELECT * INTO v_session
  FROM public.webchat_sessions
  WHERE widget_id = p_widget_id
    AND visitor_id = p_visitor_id
    AND created_at > now() - interval '7 days'
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND AND v_session.conversation_id IS NOT NULL THEN
    UPDATE public.webchat_sessions
       SET last_seen_at = now(),
           visitor_name = COALESCE(NULLIF(p_name,  ''), visitor_name),
           visitor_email = COALESCE(NULLIF(p_email, ''), visitor_email),
           user_agent = COALESCE(p_user_agent, user_agent),
           ip = COALESCE(p_ip, ip),
           page_url = COALESCE(p_page_url, page_url)
     WHERE id = v_session.id
     RETURNING * INTO v_session;
    session_id      := v_session.id;
    session_token   := v_session.session_token;
    conversation_id := v_session.conversation_id;
    contact_id      := v_session.contact_id;
    is_new          := false;
    RETURN NEXT;
    RETURN;
  END IF;

  v_is_new := true;

  -- Localiza o contato pelo identificador nativo do Webchat
  SELECT id INTO v_contact_id
  FROM public.contacts
  WHERE brand_id = v_brand_id
    AND webchat_visitor_id = p_visitor_id
  LIMIT 1;

  -- Fallback: contatos antigos que guardavam o id apenas no metadata
  IF v_contact_id IS NULL THEN
    SELECT id INTO v_contact_id
    FROM public.contacts
    WHERE brand_id = v_brand_id
      AND metadata->>'webchat_visitor_id' = p_visitor_id
    LIMIT 1;

    IF v_contact_id IS NOT NULL THEN
      UPDATE public.contacts
         SET webchat_visitor_id = p_visitor_id
       WHERE id = v_contact_id;
    END IF;
  END IF;

  IF v_contact_id IS NULL THEN
    INSERT INTO public.contacts (brand_id, webchat_visitor_id, name, profile_name, metadata)
    VALUES (
      v_brand_id,
      p_visitor_id,
      p_name,
      p_name,
      jsonb_build_object(
        'webchat_visitor_id', p_visitor_id,
        'webchat_email',      p_email,
        'source',             'webchat'
      )
    )
    RETURNING id INTO v_contact_id;
  ELSE
    UPDATE public.contacts
       SET name = COALESCE(NULLIF(p_name, ''), name),
           profile_name = COALESCE(NULLIF(p_name, ''), profile_name),
           metadata = COALESCE(metadata, '{}'::jsonb)
             || jsonb_build_object('webchat_email', p_email)
     WHERE id = v_contact_id;
  END IF;

  BEGIN
    SELECT public.pick_next_assignee(v_channel_id) INTO v_assignee;
  EXCEPTION WHEN OTHERS THEN
    v_assignee := NULL;
  END;

  INSERT INTO public.conversations (
    brand_id, contact_id, channel_id, status, assigned_to,
    unread_count, last_message_at, window_expires_at
  ) VALUES (
    v_brand_id, v_contact_id, v_channel_id, 'aberto', v_assignee,
    1, now(), NULL
  )
  RETURNING id INTO v_conv_id;

  INSERT INTO public.webchat_sessions (
    widget_id, brand_id, channel_id, conversation_id, contact_id,
    visitor_id, visitor_name, visitor_email,
    user_agent, ip, page_url
  ) VALUES (
    p_widget_id, v_brand_id, v_channel_id, v_conv_id, v_contact_id,
    p_visitor_id, p_name, p_email,
    p_user_agent, p_ip, p_page_url
  )
  RETURNING * INTO v_session;

  session_id      := v_session.id;
  session_token   := v_session.session_token;
  conversation_id := v_conv_id;
  contact_id      := v_contact_id;
  is_new          := v_is_new;
  RETURN NEXT;
END;
$function$;
