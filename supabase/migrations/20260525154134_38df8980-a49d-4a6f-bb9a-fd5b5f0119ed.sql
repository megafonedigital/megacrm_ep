
UPDATE public.contacts
SET wa_id = substr(wa_id,1,4) || '9' || substr(wa_id,5),
    phone = '+' || substr(wa_id,1,4) || '9' || substr(wa_id,5),
    updated_at = now()
WHERE wa_id ~ '^55[0-9]{10}$';
