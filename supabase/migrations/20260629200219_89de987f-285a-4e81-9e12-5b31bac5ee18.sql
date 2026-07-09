-- =========================================================================
-- WEBCHAT WIDGETS
-- One per brand_channels row of type 'webchat'. Holds appearance + behavior.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.webchat_widgets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id      uuid NOT NULL UNIQUE REFERENCES public.brand_channels(id) ON DELETE CASCADE,
  brand_id        uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  logo_url        text,
  primary_color   text NOT NULL DEFAULT '#6366f1',
  widget_title    text NOT NULL DEFAULT 'Chat',
  welcome_message text NOT NULL DEFAULT 'Olá! Como podemos ajudar?',
  position        text NOT NULL DEFAULT 'bottom-right' CHECK (position IN ('bottom-right','bottom-left')),
  launcher_size   text NOT NULL DEFAULT 'md' CHECK (launcher_size IN ('sm','md','lg')),
  business_hours  jsonb NOT NULL DEFAULT '{"enabled": false, "timezone": "America/Sao_Paulo", "days": {}}'::jsonb,
  offline_message text NOT NULL DEFAULT 'No momento estamos fora do horário de atendimento. Deixe sua mensagem que retornaremos em breve.',
  custom_css      text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.webchat_widgets TO authenticated;
GRANT ALL ON public.webchat_widgets TO service_role;

ALTER TABLE public.webchat_widgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workspace members can view webchat widgets"
  ON public.webchat_widgets FOR SELECT
  TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id));

CREATE POLICY "Workspace members can manage webchat widgets"
  ON public.webchat_widgets FOR ALL
  TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id))
  WITH CHECK (public.has_brand_access(auth.uid(), brand_id));

CREATE INDEX idx_webchat_widgets_brand ON public.webchat_widgets(brand_id);

-- =========================================================================
-- WEBCHAT SESSIONS
-- One per visitor session. Holds visitor identity + session_token (widget auth).
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.webchat_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  widget_id        uuid NOT NULL REFERENCES public.webchat_widgets(id) ON DELETE CASCADE,
  brand_id         uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  channel_id       uuid NOT NULL REFERENCES public.brand_channels(id) ON DELETE CASCADE,
  conversation_id  uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  contact_id       uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  visitor_id       text NOT NULL,
  visitor_name     text NOT NULL,
  visitor_email    text NOT NULL,
  session_token    text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  user_agent       text,
  ip               text,
  page_url         text,
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.webchat_sessions TO authenticated;
GRANT ALL ON public.webchat_sessions TO service_role;

ALTER TABLE public.webchat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workspace members can view webchat sessions"
  ON public.webchat_sessions FOR SELECT
  TO authenticated
  USING (public.has_brand_access(auth.uid(), brand_id));

CREATE INDEX idx_webchat_sessions_widget       ON public.webchat_sessions(widget_id);
CREATE INDEX idx_webchat_sessions_conversation ON public.webchat_sessions(conversation_id);
CREATE INDEX idx_webchat_sessions_visitor      ON public.webchat_sessions(widget_id, visitor_id);
CREATE INDEX idx_webchat_sessions_token        ON public.webchat_sessions(session_token);

-- =========================================================================
-- Updated-at trigger for widgets
-- =========================================================================
CREATE OR REPLACE FUNCTION public.webchat_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_webchat_widgets_updated_at ON public.webchat_widgets;
CREATE TRIGGER trg_webchat_widgets_updated_at
  BEFORE UPDATE ON public.webchat_widgets
  FOR EACH ROW EXECUTE FUNCTION public.webchat_set_updated_at();

-- =========================================================================
-- Atomic session bootstrap: upsert contact + conversation + session
-- Called server-side from the public widget endpoint (service_role only).
-- =========================================================================
CREATE OR REPLACE FUNCTION public.webchat_start_session(
  p_widget_id   uuid,
  p_visitor_id  text,
  p_name        text,
  p_email       text,
  p_user_agent  text DEFAULT NULL,
  p_ip          text DEFAULT NULL,
  p_page_url    text DEFAULT NULL
)
RETURNS TABLE (
  session_id      uuid,
  session_token   text,
  conversation_id uuid,
  contact_id      uuid,
  is_new          boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Reuse existing session for this visitor on this widget (last 7 days)
  SELECT * INTO v_session
  FROM public.webchat_sessions
  WHERE widget_id = p_widget_id
    AND visitor_id = p_visitor_id
    AND created_at > now() - interval '7 days'
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND AND v_session.conversation_id IS NOT NULL THEN
    -- Touch + return existing
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

  -- Find or create contact by (brand, webchat_visitor_id)
  SELECT id INTO v_contact_id
  FROM public.contacts
  WHERE brand_id = v_brand_id
    AND metadata->>'webchat_visitor_id' = p_visitor_id
  LIMIT 1;

  IF v_contact_id IS NULL THEN
    INSERT INTO public.contacts (brand_id, name, profile_name, metadata)
    VALUES (
      v_brand_id,
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

  -- Pick assignee via existing round robin
  BEGIN
    SELECT public.pick_next_assignee(v_channel_id) INTO v_assignee;
  EXCEPTION WHEN OTHERS THEN
    v_assignee := NULL;
  END;

  -- Create conversation (no 24h window for webchat)
  INSERT INTO public.conversations (
    brand_id, contact_id, channel_id, status, assigned_to,
    unread_count, last_message_at, window_expires_at
  ) VALUES (
    v_brand_id, v_contact_id, v_channel_id, 'aberto', v_assignee,
    1, now(), NULL
  )
  RETURNING id INTO v_conv_id;

  -- Create session
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
$$;

-- Lock down execution: only service_role (server) may call it.
REVOKE ALL ON FUNCTION public.webchat_start_session(uuid, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.webchat_start_session(uuid, text, text, text, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webchat_start_session(uuid, text, text, text, text, text, text) TO service_role;
