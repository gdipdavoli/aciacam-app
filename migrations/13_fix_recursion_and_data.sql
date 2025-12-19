-- FIX RECURSION AND ORPHANED DATA

-- 1. Create a Secure Function to check Role (Breaks Recursion Loop)
create or replace function public.get_my_role()
returns text
language sql
security definer -- Runs with privileges of creator (usually superuser/admin)
stable
as $$
  select rol from public.socios where user_id = auth.uid() limit 1;
$$;

-- Grant execute to auth users
grant execute on function public.get_my_role to authenticated;

-- 2. Repair Orphaned Data (Fix "Unlinked" users)
-- Sync user_id with auth_user_id if user_id is missing
update public.socios
set user_id = auth_user_id::uuid
where user_id is null 
and auth_user_id is not null;

-- 3. Update SOCIOS Policy to use safe function
drop policy if exists "Admin and Staff Manage Socios" on public.socios;
create policy "Admin and Staff Manage Socios"
on public.socios
for all
to authenticated
using (
    public.get_my_role() in ('admin', 'staff')
);

-- 4. Update PEDIDOS Policy to use safe function (consistency)
drop policy if exists "Admin and Staff Manage Orders" on public.pedidos;
create policy "Admin and Staff Manage Orders"
on public.pedidos
for all
to authenticated
using (
    public.get_my_role() in ('admin', 'staff')
);

-- 5. Ensure Owner Policy is clean
-- (This was usually fine, but good to ensure no circular deps)
drop policy if exists "Socio can read own record" on public.socios;
create policy "Socio can read own record"
on public.socios
for select
to authenticated
using (
    auth.uid() = user_id
);
