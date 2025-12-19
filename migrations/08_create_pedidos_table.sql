-- Create Pedidos Table
create table if not exists public.pedidos (
    id uuid not null default gen_random_uuid() primary key,
    socio_id uuid references public.socios(id) on delete set null,
    tipo_pedido text not null default 'retiro_sede' check (tipo_pedido in ('retiro_sede', 'delivery')),
    origen text not null default 'app' check (origen in ('app', 'admin')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    estado text not null default 'pendiente' check (estado in ('pendiente', 'confirmado', 'en_preparacion', 'en_camino', 'retirado', 'entregado', 'cancelado')),
    items jsonb not null default '[]'::jsonb,
    observaciones text,
    
    -- Delivery Specifics
    direccion_entrega text,
    localidad text,

    -- Retiro Specifics
    fecha_retiro_preferida text,
    franja_horaria text
);

-- RLS
alter table public.pedidos enable row level security;

-- Policy 1: Admin/Staff can do everything
create policy "Admin and Staff can manage all orders"
on public.pedidos
for all
using (
    exists (
        select 1 from public.socios
        where user_id = auth.uid()
        and rol in ('admin', 'staff')
    )
);

-- Policy 2: Socios can see their own orders
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

-- Policy 3: Socios can create orders (for themselves)
create policy "Socios can create their own orders"
on public.pedidos
for insert
with check (
    -- Ensure they are creating for their own socio_id
    exists (
        select 1 from public.socios
        where id = public.pedidos.socio_id
        and user_id = auth.uid()
    )
);

-- Audit usage
-- (Assuming audit trigger exists, otherwise we'd add it, but for now standard usage)
