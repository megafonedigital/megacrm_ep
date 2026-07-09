CREATE INDEX IF NOT EXISTS idx_automation_runs_contact_id
  ON public.automation_runs (contact_id);

CREATE INDEX IF NOT EXISTS idx_automation_scheduled_steps_run_id
  ON public.automation_scheduled_steps (run_id);

CREATE INDEX IF NOT EXISTS idx_webchat_sessions_contact_id
  ON public.webchat_sessions (contact_id);

CREATE INDEX IF NOT EXISTS idx_webchat_sessions_merged_into_contact_id
  ON public.webchat_sessions (merged_into_contact_id);

CREATE INDEX IF NOT EXISTS idx_error_logs_conversation_id
  ON public.error_logs (conversation_id);

CREATE INDEX IF NOT EXISTS idx_error_logs_message_id
  ON public.error_logs (message_id);

CREATE OR REPLACE FUNCTION public.admin_delete_contacts(_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _deleted integer := 0;
BEGIN
  SET LOCAL statement_timeout = '120s';

  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF _ids IS NULL OR array_length(_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  CREATE TEMP TABLE _delete_contact_ids (
    id uuid PRIMARY KEY
  ) ON COMMIT DROP;

  INSERT INTO _delete_contact_ids (id)
  SELECT DISTINCT unnest(_ids)
  ON CONFLICT DO NOTHING;

  CREATE TEMP TABLE _delete_conversation_ids (
    id uuid PRIMARY KEY
  ) ON COMMIT DROP;

  INSERT INTO _delete_conversation_ids (id)
  SELECT c.id
  FROM public.conversations c
  JOIN _delete_contact_ids d ON d.id = c.contact_id
  ON CONFLICT DO NOTHING;

  CREATE TEMP TABLE _delete_message_ids (
    id uuid PRIMARY KEY
  ) ON COMMIT DROP;

  INSERT INTO _delete_message_ids (id)
  SELECT m.id
  FROM public.messages m
  JOIN _delete_conversation_ids dc ON dc.id = m.conversation_id
  ON CONFLICT DO NOTHING;

  CREATE TEMP TABLE _delete_run_ids (
    id uuid PRIMARY KEY
  ) ON COMMIT DROP;

  INSERT INTO _delete_run_ids (id)
  SELECT ar.id
  FROM public.automation_runs ar
  LEFT JOIN _delete_contact_ids d ON d.id = ar.contact_id
  LEFT JOIN _delete_conversation_ids dc ON dc.id = ar.conversation_id
  WHERE d.id IS NOT NULL OR dc.id IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- Evita que FKs ON DELETE SET NULL façam varreduras repetidas em tabelas grandes.
  UPDATE public.error_logs el
  SET message_id = NULL
  FROM _delete_message_ids dm
  WHERE el.message_id = dm.id;

  UPDATE public.error_logs el
  SET conversation_id = NULL
  FROM _delete_conversation_ids dc
  WHERE el.conversation_id = dc.id;

  UPDATE public.webchat_sessions ws
  SET conversation_id = NULL
  FROM _delete_conversation_ids dc
  WHERE ws.conversation_id = dc.id;

  UPDATE public.webchat_sessions ws
  SET contact_id = NULL
  FROM _delete_contact_ids d
  WHERE ws.contact_id = d.id;

  UPDATE public.webchat_sessions ws
  SET merged_into_contact_id = NULL
  FROM _delete_contact_ids d
  WHERE ws.merged_into_contact_id = d.id;

  UPDATE public.ai_agent_threads t
  SET contact_id = NULL
  FROM _delete_contact_ids d
  WHERE t.contact_id = d.id;

  DELETE FROM public.automation_run_steps s
  USING _delete_run_ids r
  WHERE s.run_id = r.id;

  DELETE FROM public.automation_scheduled_steps s
  USING _delete_run_ids r
  WHERE s.run_id = r.id;

  DELETE FROM public.automation_runs ar
  USING _delete_run_ids r
  WHERE ar.id = r.id;

  DELETE FROM public.ai_agent_delivery_jobs j
  USING _delete_conversation_ids dc
  WHERE j.conversation_id = dc.id;

  DELETE FROM public.messages m
  USING _delete_conversation_ids dc
  WHERE m.conversation_id = dc.id;

  DELETE FROM public.internal_notes n
  USING _delete_conversation_ids dc
  WHERE n.conversation_id = dc.id;

  DELETE FROM public.conversation_events e
  USING _delete_conversation_ids dc
  WHERE e.conversation_id = dc.id;

  DELETE FROM public.conversations c
  USING _delete_conversation_ids dc
  WHERE c.id = dc.id;

  DELETE FROM public.contacts c
  USING _delete_contact_ids d
  WHERE c.id = d.id;

  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted;
END;
$function$;