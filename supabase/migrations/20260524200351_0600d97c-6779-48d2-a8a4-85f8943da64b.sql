ALTER TABLE public.broadcasts
  DROP COLUMN IF EXISTS send_window_start,
  DROP COLUMN IF EXISTS send_window_end,
  DROP COLUMN IF EXISTS channel_daily_tier;