-- SCHEMA UPDATES (Audit & Socios)

-- 1. Re-define audit_logs to meet strict requirements
drop table if exists public.audit_logs cascade;

create table public.audit_logs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id), -- Strict link to Auth User
    actor_socio_id uuid null references public.socios(id) on delete set null, -- Optional link to Socio
    action text not null, -- 'CREATE', 'UPDATE', 'DELETE', 'INVITE_SOCIO', etc.
    entity_type text not null, -- 'PRODUCT', 'SOCIO', 'ORDER'
    entity_id text not null,
    details jsonb not null,
    created_at timestamptz not null default now()
);

-- Indices for Audit Logs
create index idx_audit_logs_entity on public.audit_logs(entity_type, entity_id, created_at desc);
create index idx_audit_logs_user on public.audit_logs(user_id, created_at desc);

-- RLS for Audit Logs
alter table public.audit_logs enable row level security;

create policy "admin_view_audit_logs" on public.audit_logs
for select using (
    exists (select 1 from public.socios where user_id = auth.uid() and rol = 'admin')
);

-- Allow Insert for System/Admin/Staff (Trigger runs as SECURITY DEFINER so it bypasses this, but good for manual inserts)
create policy "allow_insert_audit_logs" on public.audit_logs
for insert with check (true); 


-- 2. Update Socios Table
alter table public.socios 
    add column if not exists auth_user_id uuid references auth.users(id),
    add column if not exists status text not null default 'ready_to_invite',
    add column if not exists invited_at timestamptz,
    add column if not exists invited_by uuid references auth.users(id),
    add column if not exists terms_accepted_at timestamptz,
    add column if not exists terms_version text default 'v1',
    add column if not exists onboarding_completed_at timestamptz;

-- Add Unique Constraint on auth_user_id
alter table public.socios drop constraint if exists socios_auth_user_id_key;
alter table public.socios add constraint socios_auth_user_id_key unique (auth_user_id);

-- Indices for Socios
create index if not exists idx_socios_status on public.socios(status);
create index if not exists idx_socios_auth_user_id on public.socios(auth_user_id);
