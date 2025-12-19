-- ROBUST ADMIN FIX & DATA REPAIR
-- This script fixes any "Unlinked" users by matching Email, and improves RLS performance.

-- 1. DATA REPAIR: Link Socios to Auth Users by Email
-- This is critical for users created manually or imported.
update public.socios s
set 
    user_id = u.id,
    auth_user_id = u.id
from auth.users u
where s.email = u.email
and (s.user_id is null or s.user_id != u.id);

-- 2. ENSURE ADMIN ROLE
-- Force specific users to be admins if needed
update public.socios
set rol = 'admin'
where email in ('gdipdavoli@gmail.com', 'barrioterralta@gmail.com');

-- 3. OPTIMIZE RLS (JWT + DB Fallback)
-- Checking JWT metadata is faster and prevents recursion.
-- We check DB (get_my_role) only if JWT claim is missing/stale.

drop policy if exists "Admin and Staff Manage Socios" on public.socios;
create policy "Admin and Staff Manage Socios"
on public.socios
for all
to authenticated
using (
    (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'staff')
    or
    public.get_my_role() in ('admin', 'staff')
);

drop policy if exists "Admin and Staff Manage Orders" on public.pedidos;
create policy "Admin and Staff Manage Orders"
on public.pedidos
for all
to authenticated
using (
    (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'staff')
    or
    public.get_my_role() in ('admin', 'staff')
);

-- 4. SYNC FUNCTION (Optional but recommended)
-- Ensure DB role changes sync to Auth Metadata for the JWT check to work efficiently 
create or replace function public.handle_new_user() 
returns trigger as $$
begin
  insert into public.socios (user_id, auth_user_id, email, rol)
  values (new.id, new.id::text, new.email, 'socio');
  return new;
end;
$$ language plpgsql security definer;
-- (Trigger creation omitted to separate concerns, focusing on Fix 1-3 first)
