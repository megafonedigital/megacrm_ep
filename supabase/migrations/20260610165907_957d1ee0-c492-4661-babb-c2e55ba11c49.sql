
-- 1) Pending columns on pipeline_contacts
ALTER TABLE public.pipeline_contacts
  ADD COLUMN IF NOT EXISTS pending_assigned_to uuid,
  ADD COLUMN IF NOT EXISTS pending_ai_agent_id uuid;

CREATE INDEX IF NOT EXISTS idx_pipeline_contacts_pending_by_contact
  ON public.pipeline_contacts (contact_id)
  WHERE pending_assigned_to IS NOT NULL OR pending_ai_agent_id IS NOT NULL;

-- 2) Rewrite assign_pipeline_owner
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
      v_combined_ids := v_combined_ids || v_users[v_idx];
      v_combined_kinds := v_combined_kinds || 'user';
    END LOOP;
  END IF;
  IF v_ais IS NOT NULL THEN
    FOR v_idx IN 1..COALESCE(array_length(v_ais, 1), 0) LOOP
      v_combined_ids := v_combined_ids || v_ais[v_idx];
      v_combined_kinds := v_combined_kinds || 'ai';
    END LOOP;
  END IF;

  v_n := COALESCE(array_length(v_combined_ids, 1), 0);
  v_n_users := COALESCE(array_length(v_users, 1), 0);
  v_n_ais := COALESCE(array_length(v_ais, 1), 0);
  v_only_ai := (v_n_users = 0 AND v_n_ais > 0);

  IF v_mode = 'none' OR v_n = 0 THEN RETURN NULL; END IF;

  -- Conversa mais recente
  SELECT id, assigned_to, ai_agent_id
    INTO v_conv_id, v_existing_user, v_existing_ai
    FROM public.conversations
   WHERE contact_id = p_contact_id AND brand_id = p_brand_id
   ORDER BY last_message_at DESC NULLS LAST, created_at DESC
   LIMIT 1;

  -- Caso já tenha dono e não seja regra "só IA": preservar (comportamento atual)
  IF v_conv_id IS NOT NULL AND NOT v_only_ai THEN
    IF v_existing_user IS NOT NULL THEN RETURN v_existing_user; END IF;
    IF v_existing_ai   IS NOT NULL THEN RETURN v_existing_ai;   END IF;
  END IF;

  -- Caso "só IA" + já tem essa mesma IA: nada a fazer
  IF v_conv_id IS NOT NULL AND v_only_ai AND v_existing_ai IS NOT NULL
     AND v_existing_ai = ANY(v_ais) THEN
    RETURN v_existing_ai;
  END IF;

  -- Escolhe próximo
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
    -- limpa pending se houver
    UPDATE public.pipeline_contacts
       SET pending_assigned_to = NULL, pending_ai_agent_id = NULL
     WHERE pipeline_id = p_pipeline_id AND contact_id = p_contact_id
       AND (pending_assigned_to IS NOT NULL OR pending_ai_agent_id IS NOT NULL);
  ELSE
    -- Sem conversa: grava como pending no(s) card(s) deste contato neste pipeline
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

GRANT EXECUTE ON FUNCTION public.assign_pipeline_owner(uuid, uuid, uuid) TO authenticated, service_role;

-- 3) Trigger: ao criar conversa, aplica pending_* dos cards do contato
CREATE OR REPLACE FUNCTION public.apply_pipeline_pending_owner_on_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid;
  v_ai uuid;
BEGIN
  -- procura QUALQUER card pendente desse contato (preferindo o mais recente)
  SELECT pending_assigned_to, pending_ai_agent_id
    INTO v_user, v_ai
    FROM public.pipeline_contacts
   WHERE contact_id = NEW.contact_id
     AND (pending_assigned_to IS NOT NULL OR pending_ai_agent_id IS NOT NULL)
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_ai IS NOT NULL THEN
    NEW.ai_agent_id := v_ai;
    NEW.assigned_to := NULL;
  ELSIF v_user IS NOT NULL AND NEW.assigned_to IS NULL THEN
    NEW.assigned_to := v_user;
  ELSE
    RETURN NEW;
  END IF;

  -- limpa pendentes do contato
  UPDATE public.pipeline_contacts
     SET pending_assigned_to = NULL, pending_ai_agent_id = NULL
   WHERE contact_id = NEW.contact_id
     AND (pending_assigned_to IS NOT NULL OR pending_ai_agent_id IS NOT NULL);

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_apply_pipeline_pending_owner ON public.conversations;
CREATE TRIGGER trg_apply_pipeline_pending_owner
  BEFORE INSERT ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.apply_pipeline_pending_owner_on_conversation();
