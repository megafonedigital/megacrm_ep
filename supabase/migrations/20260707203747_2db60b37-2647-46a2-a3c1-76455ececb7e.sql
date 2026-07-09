-- Add channel filter to inbox RPCs (additive — mantém retrocompat)

-- 1) inbox_list_conversations: adiciona p_channel_ids e p_include_none_channel no fim
DROP FUNCTION IF EXISTS public.inbox_list_conversations(uuid, text, text, uuid[], boolean, uuid[], boolean, uuid[], timestamptz, uuid, integer, text);

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
  p_limit integer DEFAULT 100,
  p_search text DEFAULT NULL,
  p_channel_ids uuid[] DEFAULT NULL,
  p_include_none_channel boolean DEFAULT false
)
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
  v_has_channel_filter boolean := (p_channel_ids IS NOT NULL AND array_length(p_channel_ids, 1) > 0) OR p_include_none_channel;
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
    AND (
      NOT v_has_channel_filter
      OR (
        (p_include_none_channel AND c.channel_id IS NULL)
        OR (p_channel_ids IS NOT NULL AND array_length(p_channel_ids, 1) > 0 AND c.channel_id = ANY(p_channel_ids))
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

GRANT EXECUTE ON FUNCTION public.inbox_list_conversations(
  uuid, text, text, uuid[], boolean, uuid[], boolean, uuid[], timestamptz, uuid, integer, text, uuid[], boolean
) TO authenticated;

-- 2) inbox_overview: mesma assinatura, adiciona no_channel e per_channel no retorno JSON
CREATE OR REPLACE FUNCTION public.inbox_overview(
  p_brand_id uuid,
  p_status text DEFAULT NULL,
  p_assignment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_elevated boolean;
  v_result jsonb;
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

  WITH base AS (
    SELECT id, contact_id, brand_id, status, assigned_to, ai_agent_id, unread_count, channel_id
    FROM public.conversations
    WHERE brand_id = p_brand_id
      AND last_message_at IS NOT NULL
      AND (
        v_elevated
        OR assigned_to = v_uid
        OR assigned_to IS NULL
      )
  ),
  scoped_assign AS (
    SELECT * FROM base
    WHERE CASE
      WHEN p_assignment = 'mine' THEN assigned_to = v_uid
      WHEN p_assignment = 'unassigned' THEN assigned_to IS NULL AND ai_agent_id IS NULL
      WHEN p_assignment = 'unread' THEN COALESCE(unread_count, 0) > 0
      ELSE TRUE
    END
  ),
  scoped_status AS (
    SELECT * FROM base
    WHERE p_status IS NULL OR p_status = 'all' OR status = p_status
  )
  SELECT jsonb_build_object(
    'all',         (SELECT count(*) FROM scoped_status),
    'mine',        (SELECT count(*) FROM scoped_status WHERE assigned_to = v_uid),
    'unassigned',  (SELECT count(*) FROM scoped_status WHERE assigned_to IS NULL AND ai_agent_id IS NULL),
    'unread',      (SELECT count(*) FROM scoped_status WHERE COALESCE(unread_count,0) > 0),
    'aberto',      (SELECT count(*) FROM scoped_assign WHERE status = 'aberto'),
    'pendente',    (SELECT count(*) FROM scoped_assign WHERE status = 'pendente'),
    'resolvido',   (SELECT count(*) FROM scoped_assign WHERE status = 'resolvido'),
    'all_status',  (SELECT count(*) FROM scoped_assign),
    'no_assignee', (SELECT count(*) FROM scoped_status WHERE assigned_to IS NULL AND ai_agent_id IS NULL),
    'no_ai_agent', (SELECT count(*) FROM scoped_status WHERE ai_agent_id IS NULL),
    'no_channel',  (SELECT count(*) FROM scoped_status WHERE channel_id IS NULL),
    'per_user', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', assigned_to, 'count', cnt)), '[]'::jsonb)
      FROM (
        SELECT assigned_to, count(*) AS cnt
        FROM scoped_status
        WHERE assigned_to IS NOT NULL
        GROUP BY assigned_to
      ) s
    ),
    'per_ai_agent', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('ai_agent_id', ai_agent_id, 'count', cnt)), '[]'::jsonb)
      FROM (
        SELECT ai_agent_id, count(*) AS cnt
        FROM scoped_status
        WHERE ai_agent_id IS NOT NULL
        GROUP BY ai_agent_id
      ) s
    ),
    'per_channel', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('channel_id', channel_id, 'count', cnt)), '[]'::jsonb)
      FROM (
        SELECT channel_id, count(*) AS cnt
        FROM scoped_status
        WHERE channel_id IS NOT NULL
        GROUP BY channel_id
      ) s
    ),
    'per_pipeline', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('pipeline_id', pipeline_id, 'count', cnt)), '[]'::jsonb)
      FROM (
        SELECT pc.pipeline_id, count(DISTINCT c.id) AS cnt
        FROM scoped_status c
        JOIN public.pipeline_contacts pc
          ON pc.contact_id = c.contact_id AND pc.brand_id = c.brand_id
        GROUP BY pc.pipeline_id
      ) s
    ),
    'per_stage', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('stage_id', stage_id, 'count', cnt)), '[]'::jsonb)
      FROM (
        SELECT pc.stage_id, count(DISTINCT c.id) AS cnt
        FROM scoped_status c
        JOIN public.pipeline_contacts pc
          ON pc.contact_id = c.contact_id AND pc.brand_id = c.brand_id
        GROUP BY pc.stage_id
      ) s
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.inbox_overview(uuid, text, text) TO authenticated;

-- 3) Índice de apoio para filtragem por canal
CREATE INDEX IF NOT EXISTS idx_conversations_brand_channel_last
  ON public.conversations (brand_id, channel_id, last_message_at DESC NULLS LAST)
  WHERE last_message_at IS NOT NULL;
