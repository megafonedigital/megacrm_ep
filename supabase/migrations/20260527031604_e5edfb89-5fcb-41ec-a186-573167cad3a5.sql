
DROP TRIGGER IF EXISTS trg_block_developer_channel_agent ON public.channel_agents;
DROP FUNCTION IF EXISTS public.block_developer_channel_agent();

DROP TRIGGER IF EXISTS trg_block_developer_conversation_assignee ON public.conversations;
DROP FUNCTION IF EXISTS public.block_developer_conversation_assignee();
