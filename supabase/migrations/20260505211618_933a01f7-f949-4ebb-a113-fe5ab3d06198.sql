-- Add explicit FK constraints with cascade for clean deletion of brands/teams/users.
-- Skip conversations/messages to preserve historical data.

-- Helper to add FK only if not present
DO $$
BEGIN
  -- teams.brand_id -> brands.id
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_brand_id_fkey') THEN
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;
  END IF;

  -- agent_teams
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_teams_team_id_fkey') THEN
    ALTER TABLE public.agent_teams
      ADD CONSTRAINT agent_teams_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_teams_user_id_fkey') THEN
    ALTER TABLE public.agent_teams
      ADD CONSTRAINT agent_teams_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_teams_pkey') THEN
    ALTER TABLE public.agent_teams ADD CONSTRAINT agent_teams_pkey PRIMARY KEY (user_id, team_id);
  END IF;

  -- agent_brands
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_brands_brand_id_fkey') THEN
    ALTER TABLE public.agent_brands
      ADD CONSTRAINT agent_brands_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_brands_user_id_fkey') THEN
    ALTER TABLE public.agent_brands
      ADD CONSTRAINT agent_brands_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_brands_pkey') THEN
    ALTER TABLE public.agent_brands ADD CONSTRAINT agent_brands_pkey PRIMARY KEY (user_id, brand_id);
  END IF;

  -- round_robin_state
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'round_robin_state_team_id_fkey') THEN
    ALTER TABLE public.round_robin_state
      ADD CONSTRAINT round_robin_state_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;
  END IF;

  -- brand_secrets
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brand_secrets_brand_id_fkey') THEN
    ALTER TABLE public.brand_secrets
      ADD CONSTRAINT brand_secrets_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;
  END IF;

  -- whatsapp_templates
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_templates_brand_id_fkey') THEN
    ALTER TABLE public.whatsapp_templates
      ADD CONSTRAINT whatsapp_templates_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;
  END IF;

  -- user_roles.user_id -> profiles.id
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_user_id_fkey') THEN
    ALTER TABLE public.user_roles
      ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Allow admin DELETE on agent_presence (currently no delete policy)
DROP POLICY IF EXISTS presence_delete_admin ON public.agent_presence;
CREATE POLICY presence_delete_admin ON public.agent_presence
  FOR DELETE TO authenticated USING (is_admin(auth.uid()));
