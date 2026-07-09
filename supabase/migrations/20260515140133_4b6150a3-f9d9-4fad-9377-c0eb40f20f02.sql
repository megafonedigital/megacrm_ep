DO $$
DECLARE
  r record;
  picked uuid;
BEGIN
  FOR r IN
    SELECT c.id, c.channel_id
    FROM public.conversations c
    JOIN public.brand_channels bc ON bc.id = c.channel_id
    WHERE c.assigned_to IS NULL
      AND bc.round_robin_enabled = true
    ORDER BY c.created_at ASC
  LOOP
    picked := public.pick_next_agent(r.channel_id);
    IF picked IS NOT NULL THEN
      UPDATE public.conversations SET assigned_to = picked WHERE id = r.id;
      INSERT INTO public.conversation_events (conversation_id, event_type, payload)
      VALUES (r.id, 'assigned', jsonb_build_object('assigned_to', picked, 'by', 'round_robin_backfill'));
    END IF;
  END LOOP;
END $$;