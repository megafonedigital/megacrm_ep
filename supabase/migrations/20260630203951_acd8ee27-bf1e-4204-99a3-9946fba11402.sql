
-- ============================================================
-- WEBCHAT v2: Inline mode + Phone capture + Auto-merge (webchat only)
-- ============================================================

-- 1) webchat_widgets: new display/form columns
ALTER TABLE public.webchat_widgets
  ADD COLUMN IF NOT EXISTS display_mode TEXT NOT NULL DEFAULT 'popup'
    CHECK (display_mode IN ('popup','inline')),
  ADD COLUMN IF NOT EXISTS inline_max_width INT NULL,
  ADD COLUMN IF NOT EXISTS inline_height INT NULL DEFAULT 600,
  ADD COLUMN IF NOT EXISTS inline_fill_container BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inline_align TEXT NOT NULL DEFAULT 'center'
    CHECK (inline_align IN ('left','center','right')),
  ADD COLUMN IF NOT EXISTS require_phone BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS require_name BOOLEAN NOT NULL DEFAULT true;

-- 2) webchat_sessions: phone + merge audit. visitor_email becomes nullable
--    (form no longer collects email by default).
ALTER TABLE public.webchat_sessions
  ALTER COLUMN visitor_email DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS visitor_phone TEXT NULL,
  ADD COLUMN IF NOT EXISTS merged_into_contact_id UUID NULL
    REFERENCES public.contacts(id) ON DELETE SET NULL;

-- 3) Helper: merge an orphan webchat contact into a principal contact.
--    Only invoked from webchat_start_session. Idempotent and conflict-safe
--    on per-table unique keys.
CREATE OR REPLACE FUNCTION public.webchat_merge_contacts(
  _principal uuid,
  _orphan    uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _principal IS NULL OR _orphan IS NULL OR _principal = _orphan THEN
    RETURN;
  END IF;

  -- Lock both rows to avoid concurrent merges
  PERFORM 1 FROM public.contacts WHERE id = _principal FOR UPDATE;
  PERFORM 1 FROM public.contacts WHERE id = _orphan    FOR UPDATE;

  -- Re-point FK children. For tables with unique (X, contact_id) we delete
  -- orphan rows that would collide BEFORE the UPDATE.

  -- pipeline_contacts (unique pipeline_id, contact_id)
  DELETE FROM public.pipeline_contacts
   WHERE contact_id = _orphan
     AND pipeline_id IN (SELECT pipeline_id FROM public.pipeline_contacts WHERE contact_id = _principal);
  UPDATE public.pipeline_contacts SET contact_id = _principal WHERE contact_id = _orphan;

  -- contact_tags (PK contact_id, tag_id)
  DELETE FROM public.contact_tags
   WHERE contact_id = _orphan
     AND tag_id IN (SELECT tag_id FROM public.contact_tags WHERE contact_id = _principal);
  UPDATE public.contact_tags SET contact_id = _principal WHERE contact_id = _orphan;

  -- ai_agent_contact_memory (unique agent_id, contact_id, key)
  DELETE FROM public.ai_agent_contact_memory
   WHERE contact_id = _orphan
     AND (agent_id, key) IN (
       SELECT agent_id, key FROM public.ai_agent_contact_memory WHERE contact_id = _principal
     );
  UPDATE public.ai_agent_contact_memory SET contact_id = _principal WHERE contact_id = _orphan;

  -- ellie_lead_usage (unique agent_id, contact_id)
  DELETE FROM public.ellie_lead_usage
   WHERE contact_id = _orphan
     AND agent_id IN (SELECT agent_id FROM public.ellie_lead_usage WHERE contact_id = _principal);
  UPDATE public.ellie_lead_usage SET contact_id = _principal WHERE contact_id = _orphan;

  -- Plain re-pointers (no relevant unique constraints)
  UPDATE public.conversations             SET contact_id = _principal WHERE contact_id = _orphan;
  UPDATE public.ai_agent_threads          SET contact_id = _principal WHERE contact_id = _orphan;
  UPDATE public.automation_runs           SET contact_id = _principal WHERE contact_id = _orphan;
  UPDATE public.contact_tag_events        SET contact_id = _principal WHERE contact_id = _orphan;
  UPDATE public.pipeline_contact_activities SET contact_id = _principal WHERE contact_id = _orphan;
  UPDATE public.pipeline_contact_events   SET contact_id = _principal WHERE contact_id = _orphan;
  UPDATE public.webchat_sessions          SET contact_id = _principal WHERE contact_id = _orphan;

  -- Merge metadata: orphan keys fill gaps; principal keeps precedence
  UPDATE public.contacts p
     SET metadata = COALESCE(o.metadata, '{}'::jsonb) || COALESCE(p.metadata, '{}'::jsonb)
    FROM public.contacts o
   WHERE p.id = _principal AND o.id = _orphan;

  -- Finally drop the orphan
  DELETE FROM public.contacts WHERE id = _orphan;
END;
$$;

GRANT EXECUTE ON FUNCTION public.webchat_merge_contacts(uuid,uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.webchat_merge_contacts(uuid,uuid) FROM PUBLIC, anon, authenticated;

-- 4) New webchat_start_session signature: phone optional, email optional.
--    Drops old signature first because TABLE return types can't be replaced.
DROP FUNCTION IF EXISTS public.webchat_start_session(uuid, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.webchat_start_session(
  p_widget_id   uuid,
  p_visitor_id  text,
  p_name        text,
  p_phone       text DEFAULT NULL,
  p_email       text DEFAULT NULL,
  p_user_agent  text DEFAULT NULL,
  p_ip          text DEFAULT NULL,
  p_page_url    text DEFAULT NULL
) RETURNS TABLE (
  session_id uuid,
  session_token text,
  conversation_id uuid,
  contact_id uuid,
  is_new boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  v_phone_digits text;
BEGIN
  SELECT * INTO v_widget FROM public.webchat_widgets WHERE id = p_widget_id AND active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'widget_not_found';
  END IF;
  v_channel_id := v_widget.channel_id;
  v_brand_id   := v_widget.brand_id;

  -- Normalize phone to digits only
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
    -- Look for existing principal by phone or wa_id within the brand
    SELECT id INTO v_principal
    FROM public.contacts
    WHERE brand_id = v_brand_id
      AND (phone = v_phone_digits OR wa_id = v_phone_digits)
    ORDER BY (wa_id IS NOT NULL) DESC, created_at ASC
    LIMIT 1;

    -- Look for prior webchat-only orphan with this visitor_id
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

    -- Backfill principal/orphan with whatever fields are still missing
    UPDATE public.contacts
       SET phone              = COALESCE(phone, v_phone_digits),
           webchat_visitor_id = COALESCE(webchat_visitor_id, p_visitor_id),
           name               = COALESCE(NULLIF(name,''), NULLIF(p_name,'')),
           profile_name       = COALESCE(NULLIF(profile_name,''), NULLIF(p_name,'')),
           metadata = COALESCE(metadata,'{}'::jsonb)
                      || jsonb_build_object('webchat_email', COALESCE(p_email, metadata->>'webchat_email'))
     WHERE id = v_contact_id;
  ELSE
    -- No phone: legacy behavior — match by webchat_visitor_id
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

  -- Assignment
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
$$;

GRANT EXECUTE ON FUNCTION public.webchat_start_session(uuid, text, text, text, text, text, text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.webchat_start_session(uuid, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
