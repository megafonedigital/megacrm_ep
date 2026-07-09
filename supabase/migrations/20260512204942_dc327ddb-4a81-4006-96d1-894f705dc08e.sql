
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipelines_brand_id_fkey') THEN
    ALTER TABLE public.pipelines ADD CONSTRAINT pipelines_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_stages_pipeline_id_fkey') THEN
    ALTER TABLE public.pipeline_stages ADD CONSTRAINT pipeline_stages_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_contacts_pipeline_id_fkey') THEN
    ALTER TABLE public.pipeline_contacts ADD CONSTRAINT pipeline_contacts_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_contacts_stage_id_fkey') THEN
    ALTER TABLE public.pipeline_contacts ADD CONSTRAINT pipeline_contacts_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.pipeline_stages(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_contacts_contact_id_fkey') THEN
    ALTER TABLE public.pipeline_contacts ADD CONSTRAINT pipeline_contacts_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_contacts_brand_id_fkey') THEN
    ALTER TABLE public.pipeline_contacts ADD CONSTRAINT pipeline_contacts_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;
  END IF;
END $$;
