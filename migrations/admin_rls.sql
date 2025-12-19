-- Update RLS policies to allow Admins to see everything

-- 1. Drop existing policies to be clean
drop policy if exists "Socio can read own record" on public.socios;
drop policy if exists "Admin can read all records" on public.socios;
drop policy if exists "Admin can update all records" on public.socios;
drop policy if exists "Admin can insert records" on public.socios;

-- 2. Re-create "Socio can read own record" (Base user access)
create policy "Socio can read own record"
on public.socios
for select
using (auth.uid() = user_id);

-- 3. Create "Admin can do everything"
-- We check app_metadata for 'role' = 'admin'
create policy "Admin can read all records"
on public.socios
for select
using (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

create policy "Admin can update all records"
on public.socios
for update
using (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

create policy "Admin can insert records"
on public.socios
for insert
with check (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);
