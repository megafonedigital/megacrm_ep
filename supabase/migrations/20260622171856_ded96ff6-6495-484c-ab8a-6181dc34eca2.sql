UPDATE public.ai_agents
SET help_me_slow_speed = 0.75
WHERE help_me_slow_speed IS NOT NULL
  AND help_me_slow_speed < 0.7;