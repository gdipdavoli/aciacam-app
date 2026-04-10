-- Migration 28: Fix notification policies to resolve 403 errors for admins
-- 1. Drop existing conflicting policies
drop policy if exists "Admins/Staff can manage all notifications" on public.notificaciones;
drop policy if exists "Users can view relevant notifications" on public.notificaciones;
drop policy if exists "Socios can send messages to admins" on public.notificaciones;
drop policy if exists "Socios can view their own notifications" on public.notificaciones;
drop policy if exists "Socios can update their own notifications (mark as read)" on public.notificaciones;

-- 2. Create explicit Admin/Staff policy (Highest Priority)
-- Admins/Staff should have full access to everything in this table
create policy "Admins and Staff have full access to notificaciones"
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

-- 3. Create Socio Policies
-- Socios can SELECT notifications sent TO them (not es_para_admin)
create policy "Socios can view their received notifications"
on public.notificaciones for select
using (
    not es_para_admin AND 
    auth.uid() in (select auth_user_id from public.socios where id = socio_id)
);

-- Socios can SELECT notifications sent BY them (es_para_admin)
create policy "Socios can view their sent messages to admin"
on public.notificaciones for select
using (
    es_para_admin AND 
    auth.uid() in (select auth_user_id from public.socios where id = remitente_id)
);

-- Socios can INSERT messages for admins
create policy "Socios can send messages to administration"
on public.notificaciones for insert
with check (
    es_para_admin = true AND 
    auth.uid() in (select auth_user_id from public.socios where id = remitente_id)
);

-- Socios can UPDATE (mark as read) their own received notifications
create policy "Socios can mark their notifications as read"
on public.notificaciones for update
using (
    not es_para_admin AND 
    auth.uid() in (select auth_user_id from public.socios where id = socio_id)
)
with check (
    not es_para_admin AND 
    auth.uid() in (select auth_user_id from public.socios where id = socio_id)
);
