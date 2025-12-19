-- FIX: Socio Creation Permissions
-- We need to ensure the RLS policy for INSERT is correctly applied and robust.

-- 1. Drop potentially conflicting or malformed policies
drop policy if exists "Staff and Admin can create socios" on public.socios;
drop policy if exists "admin_create_socios" on public.socios;

-- 2. Re-create the policy using FOR ALL to ensure it covers INSERT, UPDATE, etc.
-- Using 'USING' clause which applies to both existing rows (for update) and new rows (as check for insert if WITH CHECK is missing)
-- But better to be explicit.

create policy "Staff and Admin can manage all socios"
on public.socios
for all
using (
    public.get_auth_role() in ('admin', 'staff')
)
with check (
    public.get_auth_role() in ('admin', 'staff')
);

-- Note: We already have "Staff and Admin can read all socios" for SELECT.
-- Policies are OR'd, so having both is fine, but "maintain all" covers read too.
-- To be clean, we could drop the Read-Only policy, but it's safer to keep it specific if we wanted separation.
-- For now, adding this "manage all" policy guarantees they can do everything.
