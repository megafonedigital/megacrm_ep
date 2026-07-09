ALTER TABLE public.broadcasts
  ADD CONSTRAINT broadcasts_automation_id_fkey
  FOREIGN KEY (automation_id) REFERENCES public.automations(id) ON DELETE CASCADE;

ALTER TABLE public.broadcasts
  ADD CONSTRAINT broadcasts_brand_id_fkey
  FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_broadcasts_automation_id ON public.broadcasts(automation_id);
CREATE INDEX IF NOT EXISTS idx_broadcasts_brand_id ON public.broadcasts(brand_id);