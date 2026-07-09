-- Add trigger_tag
ALTER TABLE public.automations ADD COLUMN IF NOT EXISTS trigger_tag text;
CREATE INDEX IF NOT EXISTS automations_trigger_tag_idx ON public.automations (trigger_tag) WHERE status = 'active';

-- Add new statuses to enum
ALTER TYPE automation_run_status ADD VALUE IF NOT EXISTS 'sleeping';
ALTER TYPE automation_run_status ADD VALUE IF NOT EXISTS 'waiting_button';

-- Scheduled steps for time-based waits
CREATE TABLE IF NOT EXISTS public.automation_scheduled_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  resume_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS automation_scheduled_steps_resume_idx ON public.automation_scheduled_steps (resume_at);
ALTER TABLE public.automation_scheduled_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read scheduled steps"
  ON public.automation_scheduled_steps
  FOR SELECT TO authenticated
  USING (is_admin(auth.uid()));