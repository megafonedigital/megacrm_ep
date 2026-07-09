WITH ranked_duplicates AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY thread_id, role, created_at
      ORDER BY jsonb_array_length(parts) DESC, id ASC
    ) AS rn
  FROM public.copilot_messages
  WHERE role = 'assistant'
)
DELETE FROM public.copilot_messages m
USING ranked_duplicates d
WHERE m.id = d.id
  AND d.rn > 1;