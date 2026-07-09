CREATE TABLE public.user_quick_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text,
  content text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_quick_replies_user_pos ON public.user_quick_replies(user_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_quick_replies TO authenticated;
GRANT ALL ON public.user_quick_replies TO service_role;

ALTER TABLE public.user_quick_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "uqr_select_own" ON public.user_quick_replies FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "uqr_insert_own" ON public.user_quick_replies FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "uqr_update_own" ON public.user_quick_replies FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "uqr_delete_own" ON public.user_quick_replies FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER trg_uqr_updated_at
BEFORE UPDATE ON public.user_quick_replies
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();