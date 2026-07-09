
CREATE OR REPLACE FUNCTION public.admin_delete_contacts(_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _deleted integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF _ids IS NULL OR array_length(_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  SET LOCAL statement_timeout = '120s';

  -- Apaga passos e execuções de automação alcançados via conversas ou pelo próprio contato
  WITH target_runs AS (
    SELECT id FROM public.automation_runs
     WHERE contact_id = ANY(_ids)
        OR conversation_id IN (SELECT id FROM public.conversations WHERE contact_id = ANY(_ids))
  )
  DELETE FROM public.automation_run_steps WHERE run_id IN (SELECT id FROM target_runs);

  WITH target_runs AS (
    SELECT id FROM public.automation_runs
     WHERE contact_id = ANY(_ids)
        OR conversation_id IN (SELECT id FROM public.conversations WHERE contact_id = ANY(_ids))
  )
  DELETE FROM public.automation_scheduled_steps WHERE run_id IN (SELECT id FROM target_runs);

  DELETE FROM public.automation_runs
   WHERE contact_id = ANY(_ids)
      OR conversation_id IN (SELECT id FROM public.conversations WHERE contact_id = ANY(_ids));

  -- Apaga mensagens, notas e eventos das conversas do contato
  DELETE FROM public.messages
   WHERE conversation_id IN (SELECT id FROM public.conversations WHERE contact_id = ANY(_ids));

  DELETE FROM public.internal_notes
   WHERE conversation_id IN (SELECT id FROM public.conversations WHERE contact_id = ANY(_ids));

  DELETE FROM public.conversation_events
   WHERE conversation_id IN (SELECT id FROM public.conversations WHERE contact_id = ANY(_ids));

  DELETE FROM public.conversations WHERE contact_id = ANY(_ids);

  DELETE FROM public.contacts WHERE id = ANY(_ids);
  GET DIAGNOSTICS _deleted = ROW_COUNT;

  RETURN _deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_contacts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_contacts(uuid[]) TO authenticated;
