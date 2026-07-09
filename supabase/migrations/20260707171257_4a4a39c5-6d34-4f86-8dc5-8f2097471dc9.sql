-- Recreate webchat_start_session to also attach the channel's default AI agent
-- (from ai_agent_channel_assignments) to newly created conversations.
CREATE OR REPLACE FUNCTION public.webchat_start_session(
  p_widget_id uuid,
  p_visitor_id text,
  p_name text,
  p_phone text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text,
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
  v_widget      public.webchat_widgets%ROWTYPE;
  v_channel_id  uuid;
  v_brand_id    uuid;
  v_contact_id  uuid;
  v_principal   uuid;
  v_orphan      uuid;
  v_conv_id     uuid;
  v_session     public.webchat_sessions%ROWTYPE;
  v_assignee    uuid;
  v_ai_agent    uuid;
  v_phone_digits text;
BEGIN
  SELECT * INTO v_widget FROM public.webchat_widgets WHERE id = p_widget_id AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'widget_not_found';
  END IF;
  v_channel_id := v_widget.channel_id;
  v_brand_id   := v_widget.brand_id;

  IF p_phone IS NOT NULL THEN
    v_phone_digits := regexp_replace(p_phone, '\D', '', 'g');
    IF length(v_phone_digits) < 8 OR length(v_phone_digits) > 15 THEN
      v_phone_digits := NULL;
    END IF;
  END IF;

  -- Reuse very recent session for the same visitor
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
           visitor_name  = COALESCE(NULLIF(p_name,''),  visitor_name),
           visitor_email = COALESCE(NULLIF(p_email,''), visitor_email),
           visitor_phone = COALESCE(v_phone_digits,     visitor_phone),
           user_agent    = COALESCE(p_user_agent, user_agent),
           ip            = COALESCE(p_ip, ip),
           page_url      = COALESCE(p_page_url, page_url)
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

  -- Resolve contact
  IF v_phone_digits IS NOT NULL THEN
    SELECT id INTO v_principal
    FROM public.contacts
    WHERE brand_id = v_brand_id
      AND (phone = v_phone_digits OR wa_id = v_phone_digits)
    ORDER BY (wa_id IS NOT NULL) DESC, created_at ASC
    LIMIT 1;

    SELECT id INTO v_orphan
    FROM public.contacts
    WHERE brand_id = v_brand_id
      AND webchat_visitor_id = p_visitor_id
    LIMIT 1;

    IF v_principal IS NOT NULL AND v_orphan IS NOT NULL AND v_principal <> v_orphan THEN
      PERFORM public.webchat_merge_contacts(v_principal, v_orphan);
      v_contact_id := v_principal;
    ELSIF v_principal IS NOT NULL THEN
      v_contact_id := v_principal;
    ELSIF v_orphan IS NOT NULL THEN
      v_contact_id := v_orphan;
    ELSE
      INSERT INTO public.contacts (brand_id, webchat_visitor_id, phone, name, profile_name, metadata)
      VALUES (
        v_brand_id, p_visitor_id, v_phone_digits, p_name, p_name,
        jsonb_build_object('source','webchat','webchat_email', p_email)
      )
      RETURNING id INTO v_contact_id;
    END IF;

    UPDATE public.contacts
       SET phone              = COALESCE(phone, v_phone_digits),
           webchat_visitor_id = COALESCE(webchat_visitor_id, p_visitor_id),
           name               = COALESCE(NULLIF(name,''), NULLIF(p_name,'')),
           profile_name       = COALESCE(NULLIF(profile_name,''), NULLIF(p_name,'')),
           metadata = COALESCE(metadata,'{}'::jsonb)
                      || jsonb_build_object('webchat_email', COALESCE(p_email, metadata->>'webchat_email'))
     WHERE id = v_contact_id;
  ELSE
    SELECT id INTO v_contact_id
    FROM public.contacts
    WHERE brand_id = v_brand_id AND webchat_visitor_id = p_visitor_id
    LIMIT 1;

    IF v_contact_id IS NULL THEN
      SELECT id INTO v_contact_id
      FROM public.contacts
      WHERE brand_id = v_brand_id AND metadata->>'webchat_visitor_id' = p_visitor_id
      LIMIT 1;
      IF v_contact_id IS NOT NULL THEN
        UPDATE public.contacts SET webchat_visitor_id = p_visitor_id WHERE id = v_contact_id;
      END IF;
    END IF;

    IF v_contact_id IS NULL THEN
      INSERT INTO public.contacts (brand_id, webchat_visitor_id, name, profile_name, metadata)
      VALUES (
        v_brand_id, p_visitor_id, p_name, p_name,
        jsonb_build_object('source','webchat','webchat_email', p_email)
      )
      RETURNING id INTO v_contact_id;
    ELSE
      UPDATE public.contacts
         SET name = COALESCE(NULLIF(name,''), NULLIF(p_name,'')),
             profile_name = COALESCE(NULLIF(profile_name,''), NULLIF(p_name,'')),
             metadata = COALESCE(metadata,'{}'::jsonb)
                        || jsonb_build_object('webchat_email', COALESCE(p_email, metadata->>'webchat_email'))
       WHERE id = v_contact_id;
    END IF;
  END IF;

  -- Human assignment
  BEGIN
    SELECT public.pick_next_assignee(v_channel_id) INTO v_assignee;
  EXCEPTION WHEN OTHERS THEN
    v_assignee := NULL;
  END;

  -- AI agent for this channel: highest positive weight among active agents
  SELECT aca.agent_id INTO v_ai_agent
  FROM public.ai_agent_channel_assignments aca
  JOIN public.ai_agents ag ON ag.id = aca.agent_id
  WHERE aca.channel_id = v_channel_id
    AND aca.weight > 0
    AND ag.status <> 'off'
  ORDER BY aca.weight DESC, aca.created_at ASC
  LIMIT 1;

  INSERT INTO public.conversations (
    brand_id, contact_id, channel_id, status, assigned_to, ai_agent_id,
    unread_count, last_message_at, window_expires_at
  ) VALUES (
    v_brand_id, v_contact_id, v_channel_id, 'aberto', v_assignee, v_ai_agent,
    1, now(), NULL
  )
  RETURNING id INTO v_conv_id;

  INSERT INTO public.webchat_sessions (
    widget_id, brand_id, channel_id, conversation_id, contact_id,
    visitor_id, visitor_name, visitor_email, visitor_phone,
    user_agent, ip, page_url,
    merged_into_contact_id
  ) VALUES (
    p_widget_id, v_brand_id, v_channel_id, v_conv_id, v_contact_id,
    p_visitor_id, p_name, NULLIF(p_email,''), v_phone_digits,
    p_user_agent, p_ip, p_page_url,
    CASE WHEN v_orphan IS NOT NULL AND v_principal IS NOT NULL AND v_orphan <> v_principal
         THEN v_principal ELSE NULL END
  )
  RETURNING * INTO v_session;

  session_id      := v_session.id;
  session_token   := v_session.session_token;
  conversation_id := v_conv_id;
  contact_id      := v_contact_id;
  is_new          := true;
  RETURN NEXT;
END;
$function$;

-- Backfill: for existing webchat conversations without an AI agent, attach the
-- channel's default AI agent (same rule).
UPDATE public.conversations c
SET ai_agent_id = (
  SELECT aca.agent_id
  FROM public.ai_agent_channel_assignments aca
  JOIN public.ai_agents ag ON ag.id = aca.agent_id
  WHERE aca.channel_id = c.channel_id
    AND aca.weight > 0
    AND ag.status <> 'off'
  ORDER BY aca.weight DESC, aca.created_at ASC
  LIMIT 1
)
FROM public.brand_channels bc
WHERE bc.id = c.channel_id
  AND bc.type = 'webchat'
  AND c.ai_agent_id IS NULL
  AND c.status <> 'resolvido';
