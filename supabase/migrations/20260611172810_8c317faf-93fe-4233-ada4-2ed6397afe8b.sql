CREATE OR REPLACE FUNCTION public.assign_pipeline_owner(p_pipeline_id uuid, p_contact_id uuid, p_brand_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mode text;
  v_users uuid[];
  v_ais uuid[];
  v_combined_ids uuid[];
  v_combined_kinds text[];
  v_n int;
  v_n_users int;
  v_n_ais int;
  v_cursor int;
  v_idx int;
  v_chosen uuid;
  v_chosen_kind text;
  v_conv_id uuid;
  v_existing_user uuid;
  v_existing_ai uuid;
  v_only_ai boolean;
BEGIN
  SELECT distribution_mode, distribution_user_ids, distribution_ai_agent_ids
    INTO v_mode, v_users, v_ais
    FROM public.pipelines
   WHERE id = p_pipeline_id AND brand_id = p_brand_id;

  IF NOT FOUND THEN RETURN NULL; END IF;

  v_combined_ids := ARRAY[]::uuid[];
  v_combined_kinds := ARRAY[]::text[];
  IF v_users IS NOT NULL THEN
    FOR v_idx IN 1..COALESCE(array_length(v_users, 1), 0) LOOP
      v_combined_ids := array_append(v_combined_ids, v_users[v_idx]);
      v_combined_kinds := array_append(v_combined_kinds, 'user');
    END LOOP;
  END IF;
  IF v_ais IS NOT NULL THEN
    FOR v_idx IN 1..COALESCE(array_length(v_ais, 1), 0) LOOP
      v_combined_ids := array_append(v_combined_ids, v_ais[v_idx]);
      v_combined_kinds := array_append(v_combined_kinds, 'ai');
    END LOOP;
  END IF;

  v_n := COALESCE(array_length(v_combined_ids, 1), 0);
  v_n_users := COALESCE(array_length(v_users, 1), 0);
  v_n_ais := COALESCE(array_length(v_ais, 1), 0);
  v_only_ai := (v_n_users = 0 AND v_n_ais > 0);

  IF v_mode = 'none' OR v_n = 0 THEN RETURN NULL; END IF;

  SELECT id, assigned_to, ai_agent_id
    INTO v_conv_id, v_existing_user, v_existing_ai
    FROM public.conversations
   WHERE contact_id = p_contact_id AND brand_id = p_brand_id
   ORDER BY last_message_at DESC NULLS LAST, created_at DESC
   LIMIT 1;

  IF v_conv_id IS NOT NULL AND NOT v_only_ai THEN
    IF v_existing_user IS NOT NULL THEN RETURN v_existing_user; END IF;
    IF v_existing_ai   IS NOT NULL THEN RETURN v_existing_ai;   END IF;
  END IF;

  IF v_conv_id IS NOT NULL AND v_only_ai AND v_existing_ai IS NOT NULL
     AND v_existing_ai = ANY(v_ais) THEN
    RETURN v_existing_ai;
  END IF;

  IF v_mode = 'random' THEN
    v_idx := 1 + floor(random() * v_n)::int;
  ELSE
    UPDATE public.pipelines
       SET distribution_cursor = distribution_cursor + 1
     WHERE id = p_pipeline_id
     RETURNING (distribution_cursor - 1) INTO v_cursor;
    v_idx := 1 + (v_cursor % v_n);
  END IF;

  v_chosen := v_combined_ids[v_idx];
  v_chosen_kind := v_combined_kinds[v_idx];

  IF v_chosen IS NULL THEN RETURN NULL; END IF;

  IF v_conv_id IS NOT NULL THEN
    IF v_chosen_kind = 'ai' THEN
      UPDATE public.conversations
         SET ai_agent_id = v_chosen, assigned_to = NULL, updated_at = now()
       WHERE id = v_conv_id;
    ELSE
      UPDATE public.conversations
         SET assigned_to = v_chosen, ai_agent_id = NULL, updated_at = now()
       WHERE id = v_conv_id;
    END IF;
    UPDATE public.pipeline_contacts
       SET pending_assigned_to = NULL, pending_ai_agent_id = NULL
     WHERE pipeline_id = p_pipeline_id AND contact_id = p_contact_id
       AND (pending_assigned_to IS NOT NULL OR pending_ai_agent_id IS NOT NULL);
  ELSE
    IF v_chosen_kind = 'ai' THEN
      UPDATE public.pipeline_contacts
         SET pending_ai_agent_id = v_chosen, pending_assigned_to = NULL
       WHERE pipeline_id = p_pipeline_id AND contact_id = p_contact_id;
    ELSE
      UPDATE public.pipeline_contacts
         SET pending_assigned_to = v_chosen, pending_ai_agent_id = NULL
       WHERE pipeline_id = p_pipeline_id AND contact_id = p_contact_id;
    END IF;
  END IF;

  RETURN v_chosen;
END;
$function$;