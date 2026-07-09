
CREATE OR REPLACE FUNCTION public.inbox_list_conversations(
  p_brand_id uuid,
  p_status text DEFAULT NULL,
  p_assignment text DEFAULT NULL,
  p_user_ids uuid[] DEFAULT NULL,
  p_include_none_user boolean DEFAULT false,
  p_ai_agent_ids uuid[] DEFAULT NULL,
  p_include_none_ai_agent boolean DEFAULT false,
  p_contact_ids uuid[] DEFAULT NULL,
  p_cursor_ts timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_limit int DEFAULT 100
)
RETURNS SETOF public.conversations
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_elevated boolean;
  v_status conversation_status;
  v_limit int := GREATEST(1, LEAST(COALESCE(p_limit, 100), 200));
  v_has_user_filter boolean := (p_user_ids IS NOT NULL AND array_length(p_user_ids, 1) > 0) OR p_include_none_user;
  v_has_ai_filter boolean := (p_ai_agent_ids IS NOT NULL AND array_length(p_ai_agent_ids, 1) > 0) OR p_include_none_ai_agent;
  v_has_contact_filter boolean := p_contact_ids IS NOT NULL AND array_length(p_contact_ids, 1) > 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_brand_access(v_uid, p_brand_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_elevated := public.is_admin(v_uid)
             OR public.has_role(v_uid, 'supervisor'::app_role)
             OR public.has_role(v_uid, 'developer'::app_role);

  BEGIN
    v_status := p_status::conversation_status;
  EXCEPTION WHEN invalid_text_representation THEN
    v_status := NULL;
  WHEN others THEN
    v_status := NULL;
  END;

  RETURN QUERY
  SELECT c.*
  FROM public.conversations c
  WHERE c.brand_id = p_brand_id
    AND c.last_message_at IS NOT NULL
    -- Visibilidade do agente comum: só vê próprias + sem dono humano/IA
    AND (
      v_elevated
      OR c.assigned_to = v_uid
      OR (c.assigned_to IS NULL AND c.ai_agent_id IS NULL)
    )
    -- Status
    AND (v_status IS NULL OR c.status = v_status)
    -- Atribuição rápida
    AND (
      p_assignment IS NULL
      OR p_assignment = 'all'
      OR (p_assignment = 'mine' AND c.assigned_to = v_uid)
      OR (p_assignment = 'unassigned' AND c.assigned_to IS NULL AND c.ai_agent_id IS NULL)
      OR (p_assignment = 'unread' AND c.unread_count > 0)
    )
    -- Filtro multi-select de usuários
    AND (
      NOT v_has_user_filter
      OR (
        (p_include_none_user AND c.assigned_to IS NULL AND c.ai_agent_id IS NULL)
        OR (p_user_ids IS NOT NULL AND array_length(p_user_ids, 1) > 0 AND c.assigned_to = ANY(p_user_ids))
      )
    )
    -- Filtro multi-select de agentes IA
    AND (
      NOT v_has_ai_filter
      OR (
        (p_include_none_ai_agent AND c.ai_agent_id IS NULL)
        OR (p_ai_agent_ids IS NOT NULL AND array_length(p_ai_agent_ids, 1) > 0 AND c.ai_agent_id = ANY(p_ai_agent_ids))
      )
    )
    -- Filtro de contatos (pipeline)
    AND (NOT v_has_contact_filter OR c.contact_id = ANY(p_contact_ids))
    -- Cursor composto
    AND (
      p_cursor_ts IS NULL
      OR c.last_message_at < p_cursor_ts
      OR (c.last_message_at = p_cursor_ts AND c.id < p_cursor_id)
    )
  ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC
  LIMIT v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.inbox_list_conversations(
  uuid, text, text, uuid[], boolean, uuid[], boolean, uuid[], timestamptz, uuid, int
) TO authenticated;
