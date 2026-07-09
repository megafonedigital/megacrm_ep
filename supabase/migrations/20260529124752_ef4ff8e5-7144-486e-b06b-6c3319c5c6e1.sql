CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  conversation_id uuid NULL,
  pipeline_id uuid NULL,
  pipeline_stage_id uuid NULL,
  assignee_id uuid NOT NULL,
  created_by uuid NOT NULL,
  scheduled_at timestamptz NOT NULL,
  note text NULL,
  status text NOT NULL DEFAULT 'pending',
  notified_at timestamptz NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointments_status_check CHECK (status IN ('pending','done','missed','cancelled'))
);

CREATE INDEX idx_appointments_brand_scheduled ON public.appointments (brand_id, scheduled_at);
CREATE INDEX idx_appointments_assignee_status ON public.appointments (assignee_id, status, scheduled_at);
CREATE INDEX idx_appointments_contact ON public.appointments (contact_id);
CREATE INDEX idx_appointments_pending_notify ON public.appointments (scheduled_at) WHERE status = 'pending' AND notified_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments TO authenticated;
GRANT ALL ON public.appointments TO service_role;

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY appointments_select ON public.appointments
  FOR SELECT TO authenticated
  USING (
    public.has_brand_access(auth.uid(), brand_id)
    AND (
      assignee_id = auth.uid()
      OR created_by = auth.uid()
      OR public.is_admin(auth.uid())
      OR public.has_role(auth.uid(), 'supervisor'::app_role)
      OR public.has_role(auth.uid(), 'developer'::app_role)
    )
  );

CREATE POLICY appointments_insert ON public.appointments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_brand_access(auth.uid(), brand_id)
    AND created_by = auth.uid()
  );

CREATE POLICY appointments_update ON public.appointments
  FOR UPDATE TO authenticated
  USING (
    public.has_brand_access(auth.uid(), brand_id)
    AND (
      assignee_id = auth.uid()
      OR created_by = auth.uid()
      OR public.is_admin(auth.uid())
      OR public.has_role(auth.uid(), 'supervisor'::app_role)
      OR public.has_role(auth.uid(), 'developer'::app_role)
    )
  )
  WITH CHECK (public.has_brand_access(auth.uid(), brand_id));

CREATE POLICY appointments_delete ON public.appointments
  FOR DELETE TO authenticated
  USING (
    public.has_brand_access(auth.uid(), brand_id)
    AND (
      assignee_id = auth.uid()
      OR created_by = auth.uid()
      OR public.is_admin(auth.uid())
      OR public.has_role(auth.uid(), 'supervisor'::app_role)
    )
  );

CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
ALTER TABLE public.appointments REPLICA IDENTITY FULL;
