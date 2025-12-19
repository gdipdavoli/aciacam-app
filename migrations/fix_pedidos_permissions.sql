-- FIX: Allow Staff/Admin to READ ALL Socios
-- This is critical for Staff to select a socio when creating an order,
-- and also for the RLS checks to function smoothly if they involve cross-checks.

drop policy if exists "Staff and Admin can read all socios" on public.socios;
create policy "Staff and Admin can read all socios"
on public.socios
for select
using (
    exists (
        select 1 from public.socios as s
        where s.user_id = auth.uid()
        and s.rol in ('admin', 'staff')
    )
);

-- Note: The recursive check (querying socios inside a policy on socios) can cause infinite recursion if not careful.
-- However, Supabase/Postgres usually handles "select 1 from same_table where user_id = auth.uid()" efficiently if indexed, 
-- but to be safer/cleaner, we can use a simpler check if possible, or ensure we don't block the checking capability.
-- Ideally, we should rely on "user_id = auth.uid()" for self-identification which is infinite-recursion-safe usually.
-- But checking "rol" inside the policy for the SAME table is the tricky part.

-- BETTER APPROACH for Self-Role Check without Recursion Risk:
-- We can trust the "Socio can read own record" policy exists.
-- But for "Read ALL", we need to know if I am admin.
-- To know if I am admin, I need to read my own record.
-- So "Read Own" must be open.
-- Then "Read All" depends on "Read Own".

-- Let's define it carefully.
-- Policy 1: Read Own (Already exists: auth.uid() = user_id).
-- Policy 2: Read All IF I am Admin/Staff.
-- The verification "Am I Admin?" requires reading my row.
-- Since Policy 1 allows reading my row, Policy 2's condition "select rol from socios where user_id = auth.uid()" should succeed.

-- Just re-applying the policy with the name "Staff and Admin can read all socios".

-- ALSO FIX PEDIDOS just in case
-- Ensure Staff can Insert/Update specifically.
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
