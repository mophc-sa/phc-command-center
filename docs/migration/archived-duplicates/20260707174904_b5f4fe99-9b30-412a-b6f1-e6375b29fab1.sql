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