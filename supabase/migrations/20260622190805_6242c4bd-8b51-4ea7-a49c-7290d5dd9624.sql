UPDATE public.brands
SET ai_humanize = jsonb_build_object(
  'enabled', true,
  'split_mode', 'paragraph_then_limit',
  'max_chars', 240,
  'max_parts', 4,
  'delay_mode', 'proportional',
  'delay_fixed_ms', 600,
  'delay_chars_per_sec', 300,
  'delay_min_ms', 250,
  'delay_max_ms', 1500
)
WHERE id = '8569eeff-0a3a-42af-91a3-2145dcbccbfe';