-- Migration: 21_cleanup_emergency_permissions
-- Description: Remove DEBUG policies and restore strict security for Pedidos.

-- 1. Drop DEBUG policies (from migrations 19 & 20)
drop policy if exists "Socios can create their own orders (DEBUG)" on public.pedidos;
drop policy if exists "Socios can view all orders (DEBUG)" on public.pedidos;

-- 2. Restore Strict INSERT Policy
-- (Allow insert only if socio_id belongs to auth user)
create policy "Socios can create their own orders"
on public.pedidos
for insert
to authenticated
with check (
    exists (
        select 1 from public.socios
        where id = socio_id
        and user_id = auth.uid()
    )
);

-- 3. Restore Strict SELECT Policy
-- (Allow view only if socio_id belongs to auth user)
create policy "Socios can view their own orders"
on public.pedidos
for select
to authenticated
using (
    exists (
        select 1 from public.socios
        where id = public.pedidos.socio_id
        and user_id = auth.uid()
    )
);

-- 4. Ensure Admin/Staff Access (Safe Re-apply)
drop policy if exists "Admin and Staff Manage Orders" on public.pedidos;
create policy "Admin and Staff Manage Orders"
on public.pedidos
for all
using (
    exists (
        select 1 from public.socios
        where user_id = auth.uid()
        and rol in ('admin', 'staff')
    )
);
