-- Migration 26: Create notificaciones table for socio communications
-- 1. Create table
create table if not exists public.notificaciones (
    id uuid default gen_random_uuid() primary key,
    socio_id uuid references public.socios(id) on delete cascade not null,
    titulo text not null,
    mensaje text not null,
    leido boolean default false,
    tipo text default 'general', -- 'general', 'delivery', 'order', etc.
    metadata jsonb default '{}'::jsonb,
    fecha_creacion timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Add description
comment on table public.notificaciones is 'Almacena notificaciones internas para los socios.';

-- 3. Enable RLS
alter table public.notificaciones enable row level security;

-- 4. Policies
create policy "Socios can view their own notifications"
on public.notificaciones for select
using (auth.uid() in (
    select auth_user_id from public.socios where id = socio_id
));

create policy "Socios can update their own notifications (mark as read)"
on public.notificaciones for update
using (auth.uid() in (
    select auth_user_id from public.socios where id = socio_id
))
with check (auth.uid() in (
    select auth_user_id from public.socios where id = socio_id
));

create policy "Admins/Staff can manage all notifications"
on public.notificaciones for all
using (
    exists (
        select 1 from public.socios
        where auth_user_id = auth.uid()
        and (rol = 'admin' or rol = 'staff')
    )
);
