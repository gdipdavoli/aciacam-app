-- Fix Pedidos Table Columns
-- This is necessary if the table 'pedidos' already existed but was missing columns like 'created_at'.

-- 1. Ensure 'created_at' exists
alter table public.pedidos 
add column if not exists created_at timestamptz not null default now();

-- 2. Ensure 'updated_at' exists
alter table public.pedidos 
add column if not exists updated_at timestamptz not null default now();

-- 3. Ensure 'items' exists and is JSONB
alter table public.pedidos 
add column if not exists items jsonb not null default '[]'::jsonb;

-- 4. Ensure other core columns exist
alter table public.pedidos 
add column if not exists estado text not null default 'pendiente';

alter table public.pedidos 
add column if not exists tipo_pedido text not null default 'retiro_sede';

alter table public.pedidos 
add column if not exists origen text not null default 'app';

alter table public.pedidos 
add column if not exists socio_id uuid references public.socios(id) on delete set null;

-- 5. Ensure RLS is enabled
alter table public.pedidos enable row level security;
