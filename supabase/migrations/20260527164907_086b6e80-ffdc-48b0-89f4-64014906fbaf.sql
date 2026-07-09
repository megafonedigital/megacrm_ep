ALTER TABLE public.pipeline_stage_activities DROP CONSTRAINT IF EXISTS pipeline_stage_activities_kind_check;
ALTER TABLE public.pipeline_stage_activities ADD CONSTRAINT pipeline_stage_activities_kind_check CHECK (kind = ANY (ARRAY['send_message'::text, 'send_template'::text, 'move_stage'::text]));
ALTER TABLE public.pipeline_stage_activities ADD COLUMN IF NOT EXISTS target_stage_id uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL;

ALTER TABLE public.pipeline_contact_activities DROP CONSTRAINT IF EXISTS pipeline_contact_activities_kind_check;
ALTER TABLE public.pipeline_contact_activities ADD CONSTRAINT pipeline_contact_activities_kind_check CHECK (kind = ANY (ARRAY['send_message'::text, 'send_template'::text, 'move_stage'::text]));
ALTER TABLE public.pipeline_contact_activities ADD COLUMN IF NOT EXISTS target_stage_id uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL;