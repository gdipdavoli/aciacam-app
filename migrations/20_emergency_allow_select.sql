-- Migration: 20_emergency_allow_select
-- Description: Temporarily allow ALL authenticated SELECTs to debug RLS blocking on return.

-- 1. Drop existing strict SELECT policy
drop policy if exists "Socios can view their own orders" on public.pedidos;

-- 2. Create permissive SELECT policy (DEBUG ONLY)
create policy "Socios can view all orders (DEBUG)"
on public.pedidos
for select
to authenticated
using (
    -- Allow ANY authenticated user to view ANY order
    true
);

-- Note: We keep the Emergency Insert policy from migration 19.
