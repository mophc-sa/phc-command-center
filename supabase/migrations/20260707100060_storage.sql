-- =========================================================
-- PHC Sales OS — Phase F: File storage (integration, phase 1)
-- A single private bucket for BOQ files, quotation PDFs, project images and
-- contracts. Access is scoped to authenticated users; uploads are limited to
-- the sales team. (Email/WhatsApp are captured as drafts in `activities`.)
-- =========================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('attachments', 'attachments', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Attachments readable by authenticated"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'attachments');

CREATE POLICY "Attachments insertable by sales team"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'attachments'
    AND public.has_any_role(auth.uid(), ARRAY['salesperson','bd_manager','sales_manager','ceo']::public.app_role[])
  );

CREATE POLICY "Attachments updatable by uploader"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'attachments' AND owner = auth.uid());

CREATE POLICY "Attachments deletable by uploader or manager"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'attachments'
    AND (owner = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['sales_manager','ceo']::public.app_role[]))
  );
