-- 修复 Storage RLS 子查询将未限定 name 解析为 projects.name，导致 TUS 创建上传被拒绝

DROP POLICY IF EXISTS "用户可以上传自己的会议音频" ON storage.objects;
DROP POLICY IF EXISTS "用户可以查看自己的会议音频" ON storage.objects;
DROP POLICY IF EXISTS "用户可以更新自己的会议音频" ON storage.objects;
DROP POLICY IF EXISTS "用户可以删除自己的会议音频" ON storage.objects;

CREATE POLICY "用户可以上传自己的会议音频"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'meeting-audio'
    AND EXISTS (
      SELECT 1
      FROM public.media_assets ma
      JOIN public.projects p ON p.id = ma.project_id
      WHERE ma.bucket = storage.objects.bucket_id
        AND ma.object_path = storage.objects.name
        AND ma.status = 'uploading'
        AND ma.created_by = auth.uid()
        AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以查看自己的会议音频"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'meeting-audio'
    AND EXISTS (
      SELECT 1
      FROM public.media_assets ma
      JOIN public.projects p ON p.id = ma.project_id
      WHERE ma.bucket = storage.objects.bucket_id
        AND ma.object_path = storage.objects.name
        AND ma.deleted_at IS NULL
        AND ma.created_by = auth.uid()
        AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以更新自己的会议音频"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'meeting-audio'
    AND EXISTS (
      SELECT 1
      FROM public.media_assets ma
      JOIN public.projects p ON p.id = ma.project_id
      WHERE ma.bucket = storage.objects.bucket_id
        AND ma.object_path = storage.objects.name
        AND ma.status = 'uploading'
        AND ma.created_by = auth.uid()
        AND p.created_by = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'meeting-audio'
    AND EXISTS (
      SELECT 1
      FROM public.media_assets ma
      JOIN public.projects p ON p.id = ma.project_id
      WHERE ma.bucket = storage.objects.bucket_id
        AND ma.object_path = storage.objects.name
        AND ma.status = 'uploading'
        AND ma.created_by = auth.uid()
        AND p.created_by = auth.uid()
    )
  );

CREATE POLICY "用户可以删除自己的会议音频"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'meeting-audio'
    AND EXISTS (
      SELECT 1
      FROM public.media_assets ma
      JOIN public.projects p ON p.id = ma.project_id
      WHERE ma.bucket = storage.objects.bucket_id
        AND ma.object_path = storage.objects.name
        AND ma.created_by = auth.uid()
        AND p.created_by = auth.uid()
    )
  );
