ALTER TABLE public.ellie_buyer_validations
  ADD CONSTRAINT ellie_buyer_validations_brand_email_key
  UNIQUE (brand_id, email);