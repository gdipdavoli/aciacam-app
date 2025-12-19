-- Create Products Table
create table if not exists public.products (
    id uuid default gen_random_uuid() primary key,
    nombre text not null,
    tipo text not null, -- 'gotero', 'flor', 'crema', 'otro'
    descripcion text,
    categoria text,
    stock_disponible int default 0,
    precio numeric default 0, -- Added detailed pricing if needed
    activo boolean default true, -- Requested is_active
    imagen text, -- Requested image_path
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- Enable RLS
alter table public.products enable row level security;

-- Policies for Products
create policy "Public can read active products"
on public.products for select
using (activo = true);

create policy "Admin can do everything with products"
on public.products for all
using (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

-- Create Storage Bucket for Product Images
insert into storage.buckets (id, name, public)
values ('products-images', 'products-images', true)
on conflict (id) do nothing;

-- Storage Policies
create policy "Public Access to Product Images"
on storage.objects for select
using ( bucket_id = 'products-images' );

create policy "Admin Write Access to Product Images"
on storage.objects for insert
with check (
  bucket_id = 'products-images'
  and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

create policy "Admin Update Access to Product Images"
on storage.objects for update
using (
  bucket_id = 'products-images'
  and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

create policy "Admin Delete Access to Product Images"
on storage.objects for delete
using (
  bucket_id = 'products-images'
  and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);
