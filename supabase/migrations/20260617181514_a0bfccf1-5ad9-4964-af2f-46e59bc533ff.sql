CREATE OR REPLACE FUNCTION public.inbox_list_conversations(p_brand_id uuid, p_status text DEFAULT NULL::text, p_assignment text DEFAULT NULL::text, p_user_ids uuid[] DEFAULT NULL::uuid[], p_include_none_user boolean DEFAULT false, p_ai_agent_ids uuid[] DEFAULT NULL::uuid[], p_include_none_ai_agent boolean DEFAULT false, p_contact_ids uuid[] DEFAULT NULL::uuid[], p_cursor_ts timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100, p_search text DEFAULT NULL::text)
 RETURNS SETOF conversations
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_elevated boolean;
  v_status conversation_status;
  v_limit int := GREATEST(1, LEAST(COALESCE(p_limit, 100), 200));
  v_has_user_filter boolean := (p_user_ids IS NOT NULL AND array_length(p_user_ids, 1) > 0) OR p_include_none_user;
  v_has_ai_filter boolean := (p_ai_agent_ids IS NOT NULL AND array_length(p_ai_agent_ids, 1) > 0) OR p_include_none_ai_agent;
  v_has_contact_filter boolean := p_contact_ids IS NOT NULL AND array_length(p_contact_ids, 1) > 0;
  v_search text;
  v_digits text;
  v_has_search boolean := false;
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

  IF p_search IS NOT NULL THEN
    v_search := lower(btrim(p_search));
    IF length(v_search) >= 2 THEN
      v_has_search := true;
      v_digits := regexp_replace(v_search, '\D', '', 'g');
    ELSE
      v_search := NULL;
    END IF;
  END IF;

  RETURN QUERY
  SELECT c.*
  FROM public.conversations c
  WHERE c.brand_id = p_brand_id
    AND (
          c.last_message_at IS NOT NULL
       OR c.assigned_to = v_uid
       OR v_has_search
    )
    AND (
      v_elevated
      OR c.assigned_to = v_uid
      OR c.assigned_to IS NULL
    )
    AND (v_status IS NULL OR c.status = v_status)
    AND (
      p_assignment IS NULL
      OR p_assignment = 'all'
      OR (p_assignment = 'mine' AND c.assigned_to = v_uid)
      OR (p_assignment = 'unassigned' AND c.assigned_to IS NULL AND c.ai_agent_id IS NULL)
      OR (p_assignment = 'unread' AND c.unread_count > 0)
    )
    AND (
      NOT v_has_user_filter
      OR (
        (p_include_none_user AND c.assigned_to IS NULL AND c.ai_agent_id IS NULL)
        OR (p_user_ids IS NOT NULL AND array_length(p_user_ids, 1) > 0 AND c.assigned_to = ANY(p_user_ids))
      )
    )
    AND (
      NOT v_has_ai_filter
      OR (
        (p_include_none_ai_agent AND c.ai_agent_id IS NULL)
        OR (p_ai_agent_ids IS NOT NULL AND array_length(p_ai_agent_ids, 1) > 0 AND c.ai_agent_id = ANY(p_ai_agent_ids))
      )
    )
    AND (NOT v_has_contact_filter OR c.contact_id = ANY(p_contact_ids))
    AND (
      NOT v_has_search
      OR EXISTS (
        SELECT 1 FROM public.contacts ct
         WHERE ct.id = c.contact_id
           AND (
             lower(coalesce(ct.name,'')) LIKE '%'||v_search||'%'
             OR lower(coalesce(ct.profile_name,'')) LIKE '%'||v_search||'%'
             OR (v_digits <> '' AND (
                  regexp_replace(coalesce(ct.phone,''), '\D', '', 'g') LIKE '%'||v_digits||'%'
                  OR regexp_replace(coalesce(ct.wa_id,''), '\D', '', 'g') LIKE '%'||v_digits||'%'
                ))
           )
      )
    )
    AND (
      p_cursor_ts IS NULL
      OR c.last_message_at < p_cursor_ts
      OR (c.last_message_at = p_cursor_ts AND c.id < p_cursor_id)
    )
  ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC
  LIMIT v_limit;
END;
$function$;