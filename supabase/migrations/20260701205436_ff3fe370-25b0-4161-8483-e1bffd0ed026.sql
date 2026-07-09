ALTER TABLE public.webchat_widgets
  ADD COLUMN IF NOT EXISTS collect_email boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS header_subtitle_online text,
  ADD COLUMN IF NOT EXISTS header_subtitle_offline text,
  ADD COLUMN IF NOT EXISTS form_name_label text,
  ADD COLUMN IF NOT EXISTS form_name_placeholder text,
  ADD COLUMN IF NOT EXISTS form_phone_label text,
  ADD COLUMN IF NOT EXISTS form_phone_placeholder text,
  ADD COLUMN IF NOT EXISTS form_email_label text,
  ADD COLUMN IF NOT EXISTS form_email_placeholder text,
  ADD COLUMN IF NOT EXISTS form_submit_label text,
  ADD COLUMN IF NOT EXISTS chat_input_placeholder text,
  ADD COLUMN IF NOT EXISTS powered_by_label text;