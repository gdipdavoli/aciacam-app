-- FUNCTION: Safe Role Check (Security Definer)
-- Bypass RLS to avoid infinite recursion when Policies check the Role in the same table.
create or replace function public.get_auth_role()
returns text
language plpgsql
security definer -- Runs with privileges of creator (postgres), bypassing RLS
as $$
declare
  user_role text;
begin
  select rol into user_role from public.socios where user_id = auth.uid();
  return user_role;
end;
$$;

-- FIX: Socios RLS (The source of recursion)
drop policy if exists "Staff and Admin can read all socios" on public.socios;
create policy "Staff and Admin can read all socios"
on public.socios
for select
using (
    public.get_auth_role() in ('admin', 'staff')
);

-- FIX: Products RLS (Updating to use safe function for consistency)
drop policy if exists "Staff and Admin can manage products" on public.products;
create policy "Staff and Admin can manage products"
on public.products
for all
using (
    public.get_auth_role() in ('admin', 'staff')
);

-- FIX: Pedidos RLS
drop policy if exists "staff_admin_manage_orders" on public.pedidos;
create policy "staff_admin_manage_orders"
on public.pedidos
for all
using (
    public.get_auth_role() in ('admin', 'staff')
);

-- FIX: Storage RLS (Images)
drop policy if exists "Staff/Admin Insert Product Images" on storage.objects;
drop policy if exists "Staff/Admin Update Product Images" on storage.objects;
drop policy if exists "Staff/Admin Delete Product Images" on storage.objects;

create policy "Staff/Admin Insert Product Images"
on storage.objects for insert
with check (
    bucket_id = 'products-images'
    and public.get_auth_role() in ('admin', 'staff')
);

create policy "Staff/Admin Update Product Images"
on storage.objects for update
using (
    bucket_id = 'products-images'
    and public.get_auth_role() in ('admin', 'staff')
);

create policy "Staff/Admin Delete Product Images"
on storage.objects for delete
using (
    bucket_id = 'products-images'
    and public.get_auth_role() in ('admin', 'staff')
);
