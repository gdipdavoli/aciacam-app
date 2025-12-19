-- Fix RLS for Products to allow Staff and Admin (based on public.socios role)
drop policy if exists "Admin can do everything with products" on public.products;
drop policy if exists "Staff and Admin can manage products" on public.products;

create policy "Staff and Admin can manage products"
on public.products
for all
using (
    exists (
        select 1 from public.socios
        where user_id = auth.uid()
        and rol in ('admin', 'staff')
    )
);

-- Fix Public Access (Read Active) - Keep existing if good, but ensure it works
drop policy if exists "Public can read active products" on public.products;
create policy "Public can read active products"
on public.products
for select
using (activo = true);


-- Fix Storage Policies for 'products-images' bucket
-- Allow Staff/Admin to Upload/Update/Delete
drop policy if exists "Admin Write Access to Product Images" on storage.objects;
drop policy if exists "Admin Update Access to Product Images" on storage.objects;
drop policy if exists "Admin Delete Access to Product Images" on storage.objects;

create policy "Staff/Admin Insert Product Images"
on storage.objects for insert
with check (
    bucket_id = 'products-images'
    and exists (
        select 1 from public.socios
        where user_id = auth.uid()
        and rol in ('admin', 'staff')
    )
);

create policy "Staff/Admin Update Product Images"
on storage.objects for update
using (
    bucket_id = 'products-images'
    and exists (
        select 1 from public.socios
        where user_id = auth.uid()
        and rol in ('admin', 'staff')
    )
);

create policy "Staff/Admin Delete Product Images"
on storage.objects for delete
using (
    bucket_id = 'products-images'
    and exists (
        select 1 from public.socios
        where user_id = auth.uid()
        and rol in ('admin', 'staff')
    )
);
