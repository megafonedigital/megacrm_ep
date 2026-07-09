CREATE OR REPLACE FUNCTION public.is_blocked(_brand uuid, _phone text, _email text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits   text;
  v_ddd      text;
  v_rest     text;
  v_variants text[] := ARRAY[]::text[];
  v_email    text;
BEGIN
  IF _brand IS NULL THEN
    RETURN false;
  END IF;

  v_digits := regexp_replace(COALESCE(_phone, ''), '\D', '', 'g');
  IF length(v_digits) > 0 THEN
    v_variants := array_append(v_variants, '+' || v_digits);
    IF left(v_digits, 2) = '55' AND length(v_digits) IN (12, 13) THEN
      v_ddd  := substring(v_digits FROM 3 FOR 2);
      v_rest := substring(v_digits FROM 5);
      IF length(v_rest) = 9 AND left(v_rest, 1) = '9' THEN
        v_variants := array_append(v_variants, '+55' || v_ddd || substring(v_rest FROM 2));
      ELSIF length(v_rest) = 8 THEN
        v_variants := array_append(v_variants, '+55' || v_ddd || '9' || v_rest);
      END IF;
    END IF;
  END IF;

  v_email := NULLIF(lower(trim(COALESCE(_email, ''))), '');

  RETURN EXISTS (
    SELECT 1 FROM public.contact_blocklist b
    WHERE b.brand_id = _brand
      AND (
        (array_length(v_variants, 1) IS NOT NULL AND b.kind = 'phone' AND b.value = ANY(v_variants))
        OR (v_email IS NOT NULL AND b.kind = 'email' AND b.value = v_email)
      )
  );
END;
$$;