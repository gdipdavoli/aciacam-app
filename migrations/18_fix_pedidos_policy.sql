-- Migration: 18_fix_pedidos_policy
-- Description: Fix RLS for Pedidos Insertion and Slot Visibility

-- 1. Ensure Slots are visible for FK validation
-- (Existing policy only allows 'active', which is fine, but let's ensure 'authenticated' has grant)
grant select on public.pickup_slots to authenticated;

-- 2. RESET Pedidos Insert Policy
drop policy if exists "Socios can create their own orders" on public.pedidos;

create policy "Socios can create their own orders"
on public.pedidos
for insert
to authenticated
with check (
    -- Allow if the inserted socio_id matches a Socio record owned by the current user
    exists (
        select 1 from public.socios
        where id = socio_id
        and user_id = auth.uid()
    )
);

-- 3. Ensure Update Policy exists (for cancelling/rescheduling?)
-- (Optional, but good practice if not present)
drop policy if exists "Socios can update their own orders" on public.pedidos;
create policy "Socios can update their own orders"
on public.pedidos
for update
to authenticated
using (
    exists (
        select 1 from public.socios
        where id = socio_id
        and user_id = auth.uid()
    )
);

-- 4. Verify Grants
grant all on public.pedidos to authenticated;
