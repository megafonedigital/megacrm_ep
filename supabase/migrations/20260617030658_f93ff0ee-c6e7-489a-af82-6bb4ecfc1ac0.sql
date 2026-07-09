
-- RLS policies for copilot-attachments bucket
-- Path layout: {user_id}/{thread_id}/{uuid}.{ext}

CREATE POLICY "Copilot users can upload own attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'copilot-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Copilot users can read own attachments"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'copilot-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Copilot users can delete own attachments"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'copilot-attachments'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
