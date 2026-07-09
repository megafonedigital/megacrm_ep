UPDATE pipeline_contacts pc
SET status = 'resolvido', updated_at = now()
WHERE pc.status = 'aberto'
  AND EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.contact_id = pc.contact_id
      AND c.brand_id  = pc.brand_id
      AND c.status    = 'resolvido'
  )
  AND NOT EXISTS (
    SELECT 1 FROM conversations c2
    WHERE c2.contact_id = pc.contact_id
      AND c2.brand_id  = pc.brand_id
      AND c2.status   <> 'resolvido'
  );