-- 1. Add rol column to socios table (SAFE)
do $$
begin
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'socios' and column_name = 'rol') then
        alter table public.socios add column rol text not null default 'socio';
    end if;
end $$;

-- 2. Verify/Add constraint for roles (SAFE)
do $$
begin
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'socios') then
        alter table public.socios drop constraint if exists valid_roles;
        alter table public.socios add constraint valid_roles check (rol in ('socio', 'staff', 'admin'));
    end if;
end $$;

-- 3. Create 'pedidos' table if it does not exist
-- NOTE: We detected that 'pedidos' is currently using LocalStorage in the app.
-- This creates the real table for the new Admin functionality.
create table if not exists public.pedidos (
    id uuid default gen_random_uuid() primary key,
    socio_id uuid references public.socios(id) on delete cascade,
    tipo_pedido text check (tipo_pedido in ('retiro_sede', 'delivery')),
    origen text default 'app',
    fecha_creacion timestamptz default now(),
    estado text default 'pendiente' check (estado in ('pendiente', 'confirmado', 'en_preparacion', 'en_camino', 'retirado', 'entregado', 'cancelado')),
    items jsonb default '[]'::jsonb,
    observaciones text,
    direccion_entrega text,
    localidad text,
    fecha_retiro_preferida date,
    franja_horaria text
);

-- 4. Enable RLS on Pedidos (Safe check)
do $$
begin
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'pedidos') then
        alter table public.pedidos enable row level security;
    end if;
end $$;

-- 5. Create Policies (Safe drops)
do $$
begin
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'pedidos') then
        
        -- Policy: Socios Own Orders
        drop policy if exists "socios_own_orders" on public.pedidos;
        create policy "socios_own_orders"
        on public.pedidos
        for select
        using (
          socio_id in (select id from public.socios where user_id = auth.uid())
        );
        
        -- Policy: Staff/Admin Manage All
        drop policy if exists "staff_admin_manage_orders" on public.pedidos;
        create policy "staff_admin_manage_orders"
        on public.pedidos
        for all
        using (
          exists (
            select 1 from public.socios
            where user_id = auth.uid()
            and rol in ('staff', 'admin')
          )
        );

    end if;
end $$;
