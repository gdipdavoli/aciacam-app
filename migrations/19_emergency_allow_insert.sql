-- Migration: 19_emergency_allow_insert
-- Description: Temporarily allow ALL authenticated inserts to debug RLS blocking.

-- 1. Drop existing strict policy
drop policy if exists "Socios can create their own orders" on public.pedidos;

-- 2. Create permissive policy (DEBUG ONLY)
create policy "Socios can create their own orders (DEBUG)"
on public.pedidos
for insert
to authenticated
with check (
    -- Allow ANY authenticated user to insert ANY order
    -- This bypasses the check for "socio_id matches auth.uid()"
    true
);

-- 3. Ensure Grants
grant all on public.pedidos to authenticated;
