-- Fix RLS for Pedidos Creation
-- The previous policy might have been too restrictive or failed due to permission chaining.

drop policy if exists "Socios can create their own orders" on public.pedidos;

create policy "Socios can create their own orders"
on public.pedidos
for insert
with check (
    -- Allow insertion if the user is authenticated and the socio_id belongs to them.
    -- We trust the 'user_id' link in the socios table.
    exists (
        select 1 from public.socios
        where id = socio_id  -- 'socio_id' refers to the new row's column
        and user_id = auth.uid()
    )
);

-- Also ensure Socios can READ their own orders (likely already exists, but reinforcing)
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

-- Grant necessary permissions just in case
grant all on public.pedidos to authenticated;
