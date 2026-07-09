
ALTER TABLE public.pipelines
  ADD COLUMN IF NOT EXISTS distribution_mode text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS distribution_user_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS distribution_cursor int NOT NULL DEFAULT 0;

ALTER TABLE public.pipelines
  DROP CONSTRAINT IF EXISTS pipelines_distribution_mode_check;
ALTER TABLE public.pipelines
  ADD CONSTRAINT pipelines_distribution_mode_check
  CHECK (distribution_mode IN ('none','round_robin','random'));

CREATE OR REPLACE FUNCTION public.assign_pipeline_owner(
  p_pipeline_id uuid,
  p_contact_id uuid,
  p_brand_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text;
  v_users uuid[];
  v_n int;
  v_cursor int;
  v_chosen uuid;
  v_conv_id uuid;
  v_existing uuid;
BEGIN
  SELECT distribution_mode, distribution_user_ids
    INTO v_mode, v_users
    FROM public.pipelines
   WHERE id = p_pipeline_id AND brand_id = p_brand_id;

  IF NOT FOUND THEN RETURN NULL; END IF;

  v_n := COALESCE(array_length(v_users, 1), 0);
  IF v_mode = 'none' OR v_n = 0 THEN RETURN NULL; END IF;

  -- Conversa mais recente do contato no workspace
  SELECT id, assigned_to
    INTO v_conv_id, v_existing
    FROM public.conversations
   WHERE contact_id = p_contact_id AND brand_id = p_brand_id
   ORDER BY last_message_at DESC NULLS LAST, created_at DESC
   LIMIT 1;

  -- Sem conversa: nada a fazer (card fica sem dono até a 1ª mensagem)
  IF v_conv_id IS NULL THEN RETURN NULL; END IF;

  -- Já tem dono: não sobrepõe
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  IF v_mode = 'random' THEN
    v_chosen := v_users[1 + floor(random() * v_n)::int];
  ELSE
    -- round_robin: avança cursor atomicamente
    UPDATE public.pipelines
       SET distribution_cursor = distribution_cursor + 1
     WHERE id = p_pipeline_id
     RETURNING (distribution_cursor - 1) INTO v_cursor;
    v_chosen := v_users[1 + (v_cursor % v_n)];
  END IF;

  IF v_chosen IS NULL THEN RETURN NULL; END IF;

  UPDATE public.conversations
     SET assigned_to = v_chosen, updated_at = now()
   WHERE id = v_conv_id;

  RETURN v_chosen;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_pipeline_owner(uuid, uuid, uuid) TO authenticated, service_role;
