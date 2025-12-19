-- Create Audit Logs table
create table if not exists public.audit_logs (
    id uuid default gen_random_uuid() primary key,
    actor_id uuid references public.socios(id) on delete set null, -- The Socio/Staff member who performed the action
    action text not null, -- 'CREATE', 'UPDATE', 'DELETE'
    entity_type text not null, -- 'PRODUCT', 'ORDER', 'SOCIO'
    entity_id text, -- ID of the affected entity
    details jsonb, -- Snapshot of changes or object
    created_at timestamptz default now()
);

-- Enable RLS
alter table public.audit_logs enable row level security;

-- Policy: Admin can view all logs
drop policy if exists "admin_view_audit_logs" on public.audit_logs;
create policy "admin_view_audit_logs" on public.audit_logs
for select
using (
    exists (
        select 1 from public.socios
        where user_id = auth.uid()
        and rol = 'admin'
    )
);

-- Policy: Staff and Admin can insert logs (logging their actions)
drop policy if exists "staff_admin_insert_audit_logs" on public.audit_logs;
create policy "staff_admin_insert_audit_logs" on public.audit_logs
for insert
with check (
    exists (
        select 1 from public.socios
        where user_id = auth.uid()
        and rol in ('staff', 'admin')
    )
);
