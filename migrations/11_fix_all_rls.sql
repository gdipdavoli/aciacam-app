-- COMPREHENSIVE RLS FIX
-- Run this if you are experiencing 403 Forbidden errors or empty profiles.

-- 1. SOCIOS Table Permissions
alter table public.socios enable row level security;

drop policy if exists "Socio can read own record" on public.socios;
create policy "Socio can read own record"
on public.socios
for select
using (
    auth.uid() = user_id
);

drop policy if exists "Socio can update own record" on public.socios;
create policy "Socio can update own record"
on public.socios
for update
using (
    auth.uid() = user_id
);

-- 2. PEDIDOS Table Permissions
alter table public.pedidos enable row level security;

drop policy if exists "Socios can create their own orders" on public.pedidos;
create policy "Socios can create their own orders"
on public.pedidos
for insert
with check (
    -- Direct check against user_id to be safe
    exists (
        select 1 from public.socios
        where id = socio_id
        and user_id = auth.uid()
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
        and user_id = auth.uid()
    )
);

-- 3. STAFF / ADMIN Overrides (Manage All)
-- Ensure 'admin' and 'staff' roles can see and edit everything
drop policy if exists "Admin/Staff Manage Socios" on public.socios;
create policy "Admin/Staff Manage Socios" on public.socios
for all using (
    exists (
        select 1 from public.socios s 
        where s.user_id = auth.uid() 
        and s.rol in ('admin', 'staff')
    )
);

drop policy if exists "Admin/Staff Manage Orders" on public.pedidos;
create policy "Admin/Staff Manage Orders" on public.pedidos
for all using (
    exists (
        select 1 from public.socios s
        where s.user_id = auth.uid() 
        and s.rol in ('admin', 'staff')
    )
);

-- 4. GRANT Usage
grant all on public.socios to authenticated;
grant all on public.pedidos to authenticated;
grant usage, select on sequence public.pedidos_id_seq to authenticated; -- If generic id
-- Gen random uuid doesn't need sequence permissions usually, but good practice if serials usage exists.

-- Fix for Products just in case
alter table public.products enable row level security;
create policy "Public Read Products" on public.products for select using (true);
