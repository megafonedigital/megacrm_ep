UPDATE public.integration_accounts
SET credentials = jsonb_set(
  COALESCE(credentials, '{}'::jsonb),
  '{webhook_signing_secret}',
  to_jsonb('d27da4c4828a892fa8d931fab45bc47d8e27df484008268d7bc8b89da2b6cf9e'::text),
  true
)
WHERE id = '8996a6b2-0479-4e76-8c89-ba6e8e7604b2';