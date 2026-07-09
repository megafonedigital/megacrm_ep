CREATE OR REPLACE FUNCTION public.inbox_overview(p_brand_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_totals jsonb;
  v_per_user jsonb;
  v_per_ai jsonb;
  v_per_pipeline jsonb;
  v_per_stage jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_brand_access(v_uid, p_brand_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'all', count(*),
    'mine', count(*) FILTER (WHERE assigned_to = v_uid),
    'unassigned', count(*) FILTER (WHERE assigned_to IS NULL AND ai_agent_id IS NULL),
    'unread', count(*) FILTER (WHERE COALESCE(unread_count,0) > 0),
    'aberto', count(*) FILTER (WHERE status = 'aberto'),
    'pendente', count(*) FILTER (WHERE status = 'pendente'),
    'resolvido', count(*) FILTER (WHERE status = 'resolvido'),
    'no_assignee', count(*) FILTER (WHERE assigned_to IS NULL AND ai_agent_id IS NULL),
    'no_ai_agent', count(*) FILTER (WHERE ai_agent_id IS NULL)
  )
  INTO v_totals
  FROM public.conversations
  WHERE brand_id = p_brand_id
    AND last_message_at IS NOT NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', assigned_to, 'count', cnt)), '[]'::jsonb)
  INTO v_per_user
  FROM (
    SELECT assigned_to, count(*) AS cnt
    FROM public.conversations
    WHERE brand_id = p_brand_id
      AND last_message_at IS NOT NULL
      AND assigned_to IS NOT NULL
    GROUP BY assigned_to
  ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('ai_agent_id', ai_agent_id, 'count', cnt)), '[]'::jsonb)
  INTO v_per_ai
  FROM (
    SELECT ai_agent_id, count(*) AS cnt
    FROM public.conversations
    WHERE brand_id = p_brand_id
      AND last_message_at IS NOT NULL
      AND ai_agent_id IS NOT NULL
    GROUP BY ai_agent_id
  ) s;

  -- Pipelines: count distinct conversations whose contact appears in a pipeline.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('pipeline_id', pipeline_id, 'count', cnt)), '[]'::jsonb)
  INTO v_per_pipeline
  FROM (
    SELECT pc.pipeline_id, count(DISTINCT c.id) AS cnt
    FROM public.conversations c
    JOIN public.pipeline_contacts pc
      ON pc.contact_id = c.contact_id AND pc.brand_id = c.brand_id
    WHERE c.brand_id = p_brand_id
      AND c.last_message_at IS NOT NULL
    GROUP BY pc.pipeline_id
  ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('stage_id', stage_id, 'count', cnt)), '[]'::jsonb)
  INTO v_per_stage
  FROM (
    SELECT pc.stage_id, count(DISTINCT c.id) AS cnt
    FROM public.conversations c
    JOIN public.pipeline_contacts pc
      ON pc.contact_id = c.contact_id AND pc.brand_id = c.brand_id
    WHERE c.brand_id = p_brand_id
      AND c.last_message_at IS NOT NULL
    GROUP BY pc.stage_id
  ) s;

  RETURN v_totals
    || jsonb_build_object(
      'per_user', v_per_user,
      'per_ai_agent', v_per_ai,
      'per_pipeline', v_per_pipeline,
      'per_stage', v_per_stage
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.inbox_overview(uuid) TO authenticated;