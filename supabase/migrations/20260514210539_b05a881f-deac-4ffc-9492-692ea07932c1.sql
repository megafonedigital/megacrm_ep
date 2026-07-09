
-- Helper: list developer user_ids (callable by any authenticated user)
CREATE OR REPLACE FUNCTION public.get_developer_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id FROM public.user_roles WHERE role = 'developer'::app_role;
$$;

REVOKE ALL ON FUNCTION public.get_developer_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_developer_ids() TO authenticated;

-- Block developers from being added as channel agents
CREATE OR REPLACE FUNCTION public.block_developer_channel_agent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.user_id AND role = 'developer'::app_role) THEN
    RAISE EXCEPTION 'Desenvolvedores não podem ser atribuídos como agentes de canal';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_developer_channel_agent ON public.channel_agents;
CREATE TRIGGER trg_block_developer_channel_agent
BEFORE INSERT OR UPDATE ON public.channel_agents
FOR EACH ROW EXECUTE FUNCTION public.block_developer_channel_agent();

-- Block developers from being assigned to conversations
CREATE OR REPLACE FUNCTION public.block_developer_conversation_assignee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.assigned_to AND role = 'developer'::app_role)
  THEN
    RAISE EXCEPTION 'Desenvolvedores não podem receber conversas atribuídas';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_developer_conversation_assignee ON public.conversations;
CREATE TRIGGER trg_block_developer_conversation_assignee
BEFORE INSERT OR UPDATE OF assigned_to ON public.conversations
FOR EACH ROW EXECUTE FUNCTION public.block_developer_conversation_assignee();
