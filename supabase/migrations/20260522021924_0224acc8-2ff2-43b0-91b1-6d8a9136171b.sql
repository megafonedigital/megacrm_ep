
-- 1. Função de merge
CREATE OR REPLACE FUNCTION public.merge_contact_duplicates(keep_id uuid, drop_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k_name text; k_meta jsonb;
  d_name text; d_meta jsonb;
  merged_meta jsonb;
BEGIN
  IF keep_id = drop_id THEN RETURN; END IF;

  SELECT name, COALESCE(metadata, '{}'::jsonb) INTO k_name, k_meta FROM contacts WHERE id = keep_id;
  SELECT name, COALESCE(metadata, '{}'::jsonb) INTO d_name, d_meta FROM contacts WHERE id = drop_id;
  IF k_name IS NULL AND d_name IS NULL THEN
    -- nada
  END IF;

  -- merge metadata (keep prevalece em chaves conflitantes)
  merged_meta := d_meta || k_meta;

  -- Move conversas
  UPDATE conversations SET contact_id = keep_id WHERE contact_id = drop_id;

  -- Move tags (ignora colisão)
  INSERT INTO contact_tags (contact_id, tag_id, created_at)
  SELECT keep_id, tag_id, created_at FROM contact_tags WHERE contact_id = drop_id
  ON CONFLICT DO NOTHING;
  DELETE FROM contact_tags WHERE contact_id = drop_id;

  -- Pipeline cards (mantém keep se já existir no mesmo pipeline)
  DELETE FROM pipeline_contacts
   WHERE contact_id = drop_id
     AND pipeline_id IN (SELECT pipeline_id FROM pipeline_contacts WHERE contact_id = keep_id);
  UPDATE pipeline_contacts SET contact_id = keep_id WHERE contact_id = drop_id;

  -- automation_runs
  UPDATE automation_runs SET contact_id = keep_id WHERE contact_id = drop_id;

  -- integration_events
  UPDATE integration_events SET contact_id = keep_id WHERE contact_id = drop_id;

  -- error_logs (não tem contact_id direto, ok)

  -- Atualiza keep com nome/metadata
  UPDATE contacts
     SET name = COALESCE(NULLIF(k_name,''), d_name),
         metadata = merged_meta,
         updated_at = now()
   WHERE id = keep_id;

  DELETE FROM contacts WHERE id = drop_id;
END;
$$;

-- 2. Mescla os pares duplicados BR (12 dígitos vs 13 com 9)
DO $$
DECLARE
  pair RECORD;
  keep_id uuid;
  drop_id uuid;
  last_a timestamptz;
  last_b timestamptz;
BEGIN
  FOR pair IN
    SELECT c1.id AS id12, c1.created_at AS ca12,
           c2.id AS id13, c2.created_at AS ca13
      FROM contacts c1
      JOIN contacts c2 ON c2.brand_id = c1.brand_id
     WHERE length(c1.wa_id) = 12
       AND c1.wa_id ~ '^55[1-9][1-9][0-9]{8}$'
       AND c2.wa_id = substring(c1.wa_id,1,4) || '9' || substring(c1.wa_id,5)
  LOOP
    SELECT max(co.last_message_at) INTO last_a FROM conversations co WHERE co.contact_id = pair.id12;
    SELECT max(co.last_message_at) INTO last_b FROM conversations co WHERE co.contact_id = pair.id13;

    IF COALESCE(last_a, 'epoch'::timestamptz) > COALESCE(last_b, 'epoch'::timestamptz) THEN
      keep_id := pair.id12; drop_id := pair.id13;
    ELSIF COALESCE(last_b, 'epoch'::timestamptz) > COALESCE(last_a, 'epoch'::timestamptz) THEN
      keep_id := pair.id13; drop_id := pair.id12;
    ELSE
      -- empate: mantém o mais antigo
      IF pair.ca12 <= pair.ca13 THEN
        keep_id := pair.id12; drop_id := pair.id13;
      ELSE
        keep_id := pair.id13; drop_id := pair.id12;
      END IF;
    END IF;

    PERFORM public.merge_contact_duplicates(keep_id, drop_id);
  END LOOP;
END $$;
