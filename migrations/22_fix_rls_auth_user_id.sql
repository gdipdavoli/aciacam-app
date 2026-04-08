-- Migration: 22_fix_rls_auth_user_id
-- Description: Update RLS policies for socios and pedidos to use auth_user_id (new standard).

-- 1. SOCIOS Table Policies Update
-- We update the policies to check both auth_user_id and the legacy user_id.

drop policy if exists "Socio can read own record" on public.socios;
create policy "Socio can read own record"
on public.socios
for select
using (
    auth.uid() = auth_user_id OR auth.uid() = user_id
);

drop policy if exists "Socio can update own record" on public.socios;
create policy "Socio can update own record"
on public.socios
for update
using (
    auth.uid() = auth_user_id OR auth.uid() = user_id
);

-- 2. PEDIDOS Table Policies Update
-- Crucial for order creation: the 'insert' check must be valid for the logged-in user.

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

-- 3. STAFF / ADMIN Overrides
-- Update overrides to also check auth_user_id.

drop policy if exists "Admin/Staff Manage Socios" on public.socios;
create policy "Admin/Staff Manage Socios" on public.socios
for all using (
    exists (
        select 1 from public.socios s 
        where (s.auth_user_id = auth.uid() OR s.user_id = auth.uid())
        and s.rol in ('admin', 'staff')
    )
);

drop policy if exists "Admin/Staff Manage Orders" on public.pedidos;
create policy "Admin/Staff Manage Orders" on public.pedidos
for all using (
    exists (
        select 1 from public.socios s
        where (s.auth_user_id = auth.uid() OR s.user_id = auth.uid())
        and s.rol in ('admin', 'staff')
    )
);

-- 4. EMERGENCY OVERRIDES CLEANUP
-- Delete the emergency policies if they exist to keep the system clean.
drop policy if exists "Socios can view all orders (DEBUG)" on public.pedidos;
