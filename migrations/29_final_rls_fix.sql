-- Migration 29: Final and absolute fix for notification RLS policies
-- 1. Clean up
drop policy if exists "Admins and Staff have full access to notificaciones" on public.notificaciones;
drop policy if exists "Socios can view their received notifications" on public.notificaciones;
drop policy if exists "Socios can view their sent messages to admin" on public.notificaciones;
drop policy if exists "Socios can send messages to administration" on public.notificaciones;
drop policy if exists "Socios can mark their notifications as read" on public.notificaciones;

-- 2. Define a very clear Admin/Staff policy
-- Admins/Staff bypass almost all restrictions on this table
create policy "Admin_Full_Access"
on public.notificaciones for all
using (
    exists (
        select 1 from public.socios
        where auth_user_id = auth.uid()
        and (rol = 'admin' or rol = 'staff')
    )
)
with check (
    exists (
        select 1 from public.socios
        where auth_user_id = auth.uid()
        and (rol = 'admin' or rol = 'staff')
    )
);

-- 3. Define Socio policies
-- Socio can SELECT all notifications involving them (sent or received)
-- This allows building a "History" or "Thread"
create policy "Socio_Read_Own_History"
on public.notificaciones for select
using (
    auth.uid() in (select auth_user_id from public.socios where id = socio_id) OR
    auth.uid() in (select auth_user_id from public.socios where id = remitente_id)
);

-- Socio can INSERT messages for admins
create policy "Socio_Insert_Admin_Message"
on public.notificaciones for insert
with check (
    es_para_admin = true AND 
    auth.uid() in (select auth_user_id from public.socios where id = remitente_id)
);

-- Socio can UPDATE (leido status) on notifications sent TO them
create policy "Socio_Update_Read_Status"
on public.notificaciones for update
using (
    not es_para_admin AND
    auth.uid() in (select auth_user_id from public.socios where id = socio_id)
)
with check (
    not es_para_admin AND
    auth.uid() in (select auth_user_id from public.socios where id = socio_id)
);
