
-- Backfill ai_agent_id nas conversas do webchat do Marcelo Horta que ficaram
-- sem agente porque foram criadas antes de a Ana ser plugada ao canal.
-- Escopo estrito: apenas o canal a928b65f-c03d-4bb6-b96f-fe605af5e1fa,
-- apenas linhas com ai_agent_id NULL, atribuindo o agente atualmente com
-- maior weight positivo e status <> 'off'.
UPDATE public.conversations c
SET ai_agent_id = pick.agent_id
FROM (
  SELECT aca.agent_id
  FROM public.ai_agent_channel_assignments aca
  JOIN public.ai_agents ag ON ag.id = aca.agent_id
  WHERE aca.channel_id = 'a928b65f-c03d-4bb6-b96f-fe605af5e1fa'
    AND aca.weight > 0
    AND ag.status <> 'off'
  ORDER BY aca.weight DESC, aca.created_at ASC
  LIMIT 1
) pick
WHERE c.channel_id = 'a928b65f-c03d-4bb6-b96f-fe605af5e1fa'
  AND c.ai_agent_id IS NULL;
