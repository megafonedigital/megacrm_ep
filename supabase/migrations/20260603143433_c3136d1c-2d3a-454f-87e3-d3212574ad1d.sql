ALTER TABLE public.integration_accounts
  ADD COLUMN IF NOT EXISTS dispatch_concurrency smallint NOT NULL DEFAULT 16
    CHECK (dispatch_concurrency BETWEEN 1 AND 64);