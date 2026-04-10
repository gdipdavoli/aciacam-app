-- Migration 27: Enhance notificaciones table for two-way communication and admin inbox
-- 1. Add new columns
alter table public.notificaciones 
add column if not exists es_para_admin boolean default false,
add column if not exists remitente_id uuid references public.socios(id);

comment on column public.notificaciones.es_para_admin is 'Indica si la notificación es un mensaje para la administración.';
comment on column public.notificaciones.remitente_id is 'Id del socio que envió el mensaje (si es_para_admin es true).';

-- 2. Update RLS Policies
-- Allow socios to insert messages for admins
create policy "Socios can send messages to admins"
on public.notificaciones for insert
with check (
    (es_para_admin = true) AND 
    (auth.uid() in (select auth_user_id from public.socios where id = remitente_id))
);

-- Update Select policy to include messages for admin if viewer is admin
drop policy if exists "Socios can view their own notifications" on public.notificaciones;
create policy "Users can view relevant notifications"
on public.notificaciones for select
using (
    -- Socio viewing their own notifications (system -> socio)
    (not es_para_admin AND auth.uid() in (select auth_user_id from public.socios where id = socio_id))
    OR
    -- Admin/Staff viewing any notification or messages sent to them (socio -> admin)
    (exists (
        select 1 from public.socios
        where auth_user_id = auth.uid()
        and (rol = 'admin' or rol = 'staff')
    ))
);
