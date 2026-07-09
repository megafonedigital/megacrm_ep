-- Generic named lock helpers (reaproveita tabela broadcast_runtime_locks)
CREATE OR REPLACE FUNCTION public.try_acquire_named_lock(_name text, _owner text, _ttl_seconds integer DEFAULT 60)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now timestamptz := now();
  v_ttl int := greatest(5, least(coalesce(_ttl_seconds, 60), 600));
  v_acquired boolean := false;
BEGIN
  INSERT INTO public.broadcast_runtime_locks (name, owner, locked_until, updated_at)
  VALUES (_name, coalesce(nullif(_owner, ''), 'unknown'), v_now + make_interval(secs => v_ttl), v_now)
  ON CONFLICT (name) DO UPDATE
    SET owner = excluded.owner,
        locked_until = excluded.locked_until,
        updated_at = excluded.updated_at
  WHERE public.broadcast_runtime_locks.locked_until < v_now
     OR public.broadcast_runtime_locks.owner = excluded.owner
  RETURNING true INTO v_acquired;
  RETURN coalesce(v_acquired, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_named_lock(_name text, _owner text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_count int;
BEGIN
  DELETE FROM public.broadcast_runtime_locks
   WHERE name = _name
     AND owner = coalesce(nullif(_owner, ''), 'unknown');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

-- Busca a conversa mais recente para uma lista de contatos em uma única query
CREATE OR REPLACE FUNCTION public.get_latest_conversations(_brand uuid, _contact_ids uuid[])
RETURNS TABLE(contact_id uuid, id uuid, window_expires_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT ON (c.contact_id) c.contact_id, c.id, c.window_expires_at
  FROM public.conversations c
  WHERE c.brand_id = _brand
    AND c.contact_id = ANY(_contact_ids)
  ORDER BY c.contact_id, c.last_message_at DESC NULLS LAST;
$$;
