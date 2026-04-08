-- Migration: 23_fix_rls_recursion
-- Description: Fix infinite recursion in RLS policies by using a SECURITY DEFINER function.

-- 1. Redefine the role check function to be robust and break recursion
create or replace function public.get_my_role()
returns text
language sql
security definer -- Crucial: runs as owner, bypassing RLS to avoid recursion
stable
as $$
  select rol from public.socios 
  where (auth_user_id = auth.uid() OR user_id = auth.uid())
  limit 1;
$$;

-- Ensure execute permissions
grant execute on function public.get_my_role to authenticated;
grant execute on function public.get_my_role to anon; -- Just in case

-- 2. Update SOCIOS policies using the function instead of subqueries
drop policy if exists "Admin/Staff Manage Socios" on public.socios;
create policy "Admin/Staff Manage Socios"
on public.socios
for all
to authenticated
using (
    public.get_my_role() in ('admin', 'staff')
);

-- 3. Update PEDIDOS policies using the function
drop policy if exists "Admin/Staff Manage Orders" on public.pedidos;
create policy "Admin/Staff Manage Orders"
on public.pedidos
for all
to authenticated
using (
    public.get_my_role() in ('admin', 'staff')
);

-- 4. Double check the "Socios can create their own orders" policy in PEDIDOS
-- This one is tricky. It's usually better to keep it simple.
-- socio_id is the primary key (UUID) of the socios table.
-- We need to check if the socio_id in the order belongs to the auth.uid().

drop policy if exists "Socios can create their own orders" on public.pedidos;
create policy "Socios can create their own orders"
on public.pedidos
for insert
with check (
    exists (
        select 1 from public.socios
        where id = socio_id
        and (auth_user_id = auth.uid() OR user_id = auth.uid())
    )
);

-- 5. Double check the "Socios can view their own orders" policy in PEDIDOS
drop policy if exists "Socios can view their own orders" on public.pedidos;
create policy "Socios can view their own orders"
on public.pedidos
for select
using (
    exists (
        select 1 from public.socios
        where id = public.pedidos.socio_id
        and (auth_user_id = auth.uid() OR user_id = auth.uid())
    )
);

-- Note: The "exists" subqueries on PEDIDOS policies are OK because they query SOCIOS, 
-- but SOCIOS policies use get_my_role() which is SECURITY DEFINER, so there's NO loop.

-- 6. Ensure the owner lookup on SOCIOS is also fixed if it was broken
drop policy if exists "Socio can read own record" on public.socios;
create policy "Socio can read own record"
on public.socios
for select
using (
    auth.uid() = auth_user_id OR auth.uid() = user_id
);
