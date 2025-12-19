-- Allow Admins and Staff to create new Socios
-- This is necessary for the "Nuevo Socio" flow in /admin/socios/new

create policy "Staff and Admin can create socios"
on public.socios
for insert
with check (
    public.get_auth_role() in ('admin', 'staff')
);
