-- Read-only migration checks. Compare source and destination during the final write freeze.
-- Expected inventory on 2026-11-19: one user/identity/profile/role/project; twenty tasks;
-- zero memberships/comments/documents/project files. Preserve all current records.
-- Use the same session timezone (UTC) on both endpoints. Reinventory at final copy.
-- Projects/tasks below exclude only feature-added columns from BOTH sides. The
-- source can therefore remain on its original schema while the destination has
-- portal_workflows applied. Verify the new defaults/workflow tables separately;
-- do not remove legacy fields from reconciliation to hide unexplained changes.
SELECT 'public.profiles' AS relation, count(*)::bigint AS records, md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY to_jsonb(t)::text), '')) AS fingerprint FROM public.profiles t
UNION ALL
SELECT 'public.user_roles' AS relation, count(*)::bigint AS records, md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY to_jsonb(t)::text), '')) AS fingerprint FROM public.user_roles t
UNION ALL
SELECT 'public.projects' AS relation, count(*)::bigint AS records, md5(coalesce(string_agg((to_jsonb(t) - ARRAY['client_brand','client_email','meeting_url'])::text, E'\n' ORDER BY (to_jsonb(t) - ARRAY['client_brand','client_email','meeting_url'])::text), '')) AS fingerprint FROM public.projects t
UNION ALL
SELECT 'public.tasks' AS relation, count(*)::bigint AS records, md5(coalesce(string_agg((to_jsonb(t) - ARRAY['content_revision','source_id','source_metadata'])::text, E'\n' ORDER BY (to_jsonb(t) - ARRAY['content_revision','source_id','source_metadata'])::text), '')) AS fingerprint FROM public.tasks t
UNION ALL
SELECT 'public.project_members' AS relation, count(*)::bigint AS records, md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY to_jsonb(t)::text), '')) AS fingerprint FROM public.project_members t
UNION ALL
SELECT 'public.comments' AS relation, count(*)::bigint AS records, md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY to_jsonb(t)::text), '')) AS fingerprint FROM public.comments t
UNION ALL
SELECT 'public.documents' AS relation, count(*)::bigint AS records, md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY to_jsonb(t)::text), '')) AS fingerprint FROM public.documents t;

-- Compare the source and destination user UUID/password fingerprint without printing hashes.
SELECT count(*) AS auth_users,
       md5(coalesce(string_agg(id::text || ':' || coalesce(encrypted_password,''), E'\n' ORDER BY id),'')) AS uuid_password_fingerprint
FROM auth.users;
SELECT count(*) AS auth_identities,
       md5(coalesce(string_agg(to_jsonb(i)::text,E'\n' ORDER BY to_jsonb(i)::text),'')) AS identity_fingerprint
FROM auth.identities i;
SELECT count(*) AS identities_without_user
FROM auth.identities i LEFT JOIN auth.users u ON u.id=i.user_id
WHERE u.id IS NULL;
SELECT count(*) AS profiles_without_user
FROM public.profiles p LEFT JOIN auth.users u ON u.id=p.id
WHERE u.id IS NULL;
SELECT count(*) AS role_without_profile
FROM public.user_roles r LEFT JOIN public.profiles p ON p.id=r.user_id
WHERE p.id IS NULL;
SELECT count(*) AS task_without_project
FROM public.tasks t LEFT JOIN public.projects p ON p.id=t.project_id
WHERE p.id IS NULL;
SELECT role,count(*) AS records FROM public.user_roles GROUP BY role ORDER BY role;
SELECT id,public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id='project-files';
SELECT count(*) AS project_file_objects FROM storage.objects WHERE bucket_id='project-files';
SELECT tablename,policyname,roles,cmd,qual,with_check
FROM pg_policies
WHERE schemaname='public' OR (schemaname='storage' AND tablename='objects')
ORDER BY schemaname,tablename,policyname;
SELECT c.relname AS relation,c.relrowsecurity AS rls
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p')
ORDER BY c.relname;
SELECT t.tgname,pg_get_triggerdef(t.oid,true) AS trigger_definition,
       pg_get_functiondef(t.tgfoid) AS function_definition
FROM pg_trigger t WHERE t.tgrelid='auth.users'::regclass AND NOT t.tgisinternal;

-- These read-only checks compare copied state, not authenticated authorization behavior.
-- Run admin/partner/client tests across two projects before production cutover.
-- Source and destination policy listings intentionally differ by the reviewed
-- workflow additions. Preserve the baseline rules and verify the new guards.
