
DROP POLICY IF EXISTS imports_bucket_select ON storage.objects;
DROP POLICY IF EXISTS imports_bucket_insert ON storage.objects;

CREATE POLICY imports_bucket_select ON storage.objects FOR SELECT USING (
  bucket_id = 'imports'
  AND public.has_any_role(auth.uid(), ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager']::public.app_role[])
);

CREATE POLICY imports_bucket_insert ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'imports'
  AND public.has_any_role(auth.uid(), ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager','bd_manager']::public.app_role[])
);

NOTIFY pgrst, 'reload schema';
