
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
  v_status conversation_status;
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

  -- Cast seguro: apenas valores válidos do enum viram filtro; outros (e 'all', NULL) significam "sem filtro de status".
  IF p_status IN ('aberto','pendente','resolvido') THEN
    v_status := p_status::conversation_status;
  ELSE
    v_status := NULL;
  END IF;

  WITH base AS (
    SELECT id, contact_id, brand_id, status, assigned_to, ai_agent_id, unread_count
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
    WHERE v_status IS NULL OR status = v_status
  )
  SELECT jsonb_build_object(
    'all',         (SELECT count(*) FROM scoped_status),
    'mine',        (SELECT count(*) FROM scoped_status WHERE assigned_to = v_uid),
    'unassigned',  (SELECT count(*) FROM scoped_status WHERE assigned_to IS NULL AND ai_agent_id IS NULL),
    'unread',      (SELECT count(*) FROM scoped_status WHERE COALESCE(unread_count,0) > 0),
    'aberto',      (SELECT count(*) FROM scoped_assign WHERE status = 'aberto'::conversation_status),
    'pendente',    (SELECT count(*) FROM scoped_assign WHERE status = 'pendente'::conversation_status),
    'resolvido',   (SELECT count(*) FROM scoped_assign WHERE status = 'resolvido'::conversation_status),
    'all_status',  (SELECT count(*) FROM scoped_assign),
    'no_assignee', (SELECT count(*) FROM scoped_status WHERE assigned_to IS NULL AND ai_agent_id IS NULL),
    'no_ai_agent', (SELECT count(*) FROM scoped_status WHERE ai_agent_id IS NULL),
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
