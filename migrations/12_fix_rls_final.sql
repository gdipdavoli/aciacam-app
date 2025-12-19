-- DEFINITIVE RLS FIX (Attempt 3 - The "Nuclear" Option for Permissions)
-- Goals:
-- 1. Unblock 'Select' on Socios for the owner (Critical for Insert Checks).
-- 2. Unblock 'Insert' on Pedidos for the owner.
-- 3. Ensure Grants are present.

-- A. RELOAD RLS on Tables
alter table public.socios enable row level security;
alter table public.pedidos enable row level security;

-- B. GRANTS (Often missed)
-- Ensure 'authenticated' users can actually access the tables at a db level
grant usage on schema public to authenticated;
grant all on public.socios to authenticated;
grant all on public.pedidos to authenticated;
-- grant usage, select on sequence public.pedidos_id_seq to authenticated; -- Removed: ID is UUID, no sequence.

-- C. SOCIOS POLICIES
-- Drop potentially conflicting policies
drop policy if exists "Socio can read own record" on public.socios;
drop policy if exists "Users can see their own socio profile" on public.socios;
drop policy if exists "Admin/Staff Manage Socios" on public.socios;
drop policy if exists "Enable read access for all users" on public.socios;

-- 1. Simple Owner Read Policy
create policy "Socio can read own record"
on public.socios
for select
to authenticated
using (
    auth.uid() = user_id
);

-- 2. Admin/Staff Overlay (Read/Write All)
create policy "Admin and Staff Manage Socios"
on public.socios
for all
to authenticated
using (
    auth.uid() in (
        select user_id from public.socios where rol in ('admin', 'staff')
    )
);

-- D. PEDIDOS POLICIES
drop policy if exists "Socios can create their own orders" on public.pedidos;
drop policy if exists "Socios can view their own orders" on public.pedidos;
drop policy if exists "Admin/Staff Manage Orders" on public.pedidos;
drop policy if exists "Admin and Staff can manage all orders" on public.pedidos;

-- 1. Insert Policy
-- Requires the user to have a socio record where user_id = auth.uid()
create policy "Socios can create their own orders"
on public.pedidos
for insert
to authenticated
with check (
    -- The socio_id being inserted MUST belong to the current auth user
    exists (
        select 1 from public.socios
        where id = socio_id
        and user_id = auth.uid()
    )
);

-- 2. Select Policy
create policy "Socios can view their own orders"
on public.pedidos
for select
to authenticated
using (
    -- The order's socio_id MUST belong to the current auth user
    exists (
        select 1 from public.socios
        where id = public.pedidos.socio_id
        and user_id = auth.uid()
    )
);

-- 3. Admin/Staff Overlay
create policy "Admin and Staff Manage Orders"
on public.pedidos
for all
to authenticated
using (
    exists (
        select 1 from public.socios
        where user_id = auth.uid()
        and rol in ('admin', 'staff')
    )
);
