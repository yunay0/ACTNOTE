-- 인증된 유저가 파일 업로드 가능
CREATE POLICY "authenticated users can upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'meetings');

-- 인증된 유저가 파일 읽기 가능
CREATE POLICY "authenticated users can read"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'meetings');

-- 본인이 올린 파일 삭제 가능
CREATE POLICY "authenticated users can delete own files"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'meetings');
