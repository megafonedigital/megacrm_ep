-- Adiciona suporte a subpastas em automation_folders
ALTER TABLE public.automation_folders
  ADD COLUMN parent_id uuid NULL REFERENCES public.automation_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_automation_folders_brand_parent
  ON public.automation_folders(brand_id, parent_id);

-- Trigger anti-ciclo + mesmo brand
CREATE OR REPLACE FUNCTION public.automation_folders_validate_parent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  cur uuid;
  parent_brand uuid;
  hops integer := 0;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'Uma pasta não pode ser pai de si mesma';
  END IF;

  -- mesmo brand
  SELECT brand_id INTO parent_brand FROM public.automation_folders WHERE id = NEW.parent_id;
  IF parent_brand IS NULL THEN
    RAISE EXCEPTION 'Pasta pai não encontrada';
  END IF;
  IF parent_brand <> NEW.brand_id THEN
    RAISE EXCEPTION 'Pasta pai pertence a outro workspace';
  END IF;

  -- detectar ciclo subindo a cadeia
  cur := NEW.parent_id;
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'Ciclo detectado na hierarquia de pastas';
    END IF;
    hops := hops + 1;
    IF hops > 100 THEN
      RAISE EXCEPTION 'Hierarquia de pastas muito profunda';
    END IF;
    SELECT parent_id INTO cur FROM public.automation_folders WHERE id = cur;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_automation_folders_validate_parent ON public.automation_folders;
CREATE TRIGGER trg_automation_folders_validate_parent
  BEFORE INSERT OR UPDATE OF parent_id, brand_id ON public.automation_folders
  FOR EACH ROW EXECUTE FUNCTION public.automation_folders_validate_parent();