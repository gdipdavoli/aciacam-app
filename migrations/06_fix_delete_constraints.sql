-- Fix FK Constraints to allow User Deletion
-- This allows deleting a user from Authentication > Users without database errors.

-- 1. Audit Logs: If an auth user is deleted, keep the log but set user_id to NULL.
ALTER TABLE public.audit_logs
DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;

ALTER TABLE public.audit_logs
ADD CONSTRAINT audit_logs_user_id_fkey
FOREIGN KEY (user_id) REFERENCES auth.users(id)
ON DELETE SET NULL;

-- 2. Socios: If an auth user is deleted (e.g. from Supabase Dashboard), unlink the socio.
-- (The App's Delete button handles this manually, but this protects manual dashboard deletions).
ALTER TABLE public.socios
DROP CONSTRAINT IF EXISTS socios_auth_user_id_fkey;

ALTER TABLE public.socios
ADD CONSTRAINT socios_auth_user_id_fkey
FOREIGN KEY (auth_user_id) REFERENCES auth.users(id)
ON DELETE SET NULL;
