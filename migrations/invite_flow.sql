-- Idempotent Migration for Robust Invitation Flow

-- 1. Create table structure if missing (original columns)
create table if not exists public.socio_invites (
  id uuid primary key default gen_random_uuid(),
  socio_id uuid not null, -- foreign key added later/checked
  email text not null,
  token text not null unique,
  created_at timestamptz default now()
);

-- 2. Add foreign key safely
do $$ 
begin
  if not exists (select 1 from information_schema.table_constraints where constraint_name = 'socio_invites_socio_id_fkey') then
    alter table public.socio_invites add constraint socio_invites_socio_id_fkey foreign key (socio_id) references public.socios(id) on delete cascade;
  end if;
end $$;

-- 3. Add Robust Flow Columns (Idempotent)
alter table public.socio_invites add column if not exists sent_at timestamptz;
alter table public.socio_invites add column if not exists expires_at timestamptz;
alter table public.socio_invites add column if not exists consumed_at timestamptz;
alter table public.socio_invites add column if not exists status text; -- 'created', 'sent', 'consumed', 'expired'
alter table public.socio_invites add column if not exists email_status text; -- 'pending', 'sent', 'error'
alter table public.socio_invites add column if not exists email_provider_id text;
alter table public.socio_invites add column if not exists last_error text;
alter table public.socio_invites add column if not exists created_by text;
alter table public.socio_invites add column if not exists used_at timestamptz; -- legacy support check

-- 4. Backfill Data (Fixing nulls for existing rows)
update public.socio_invites
set expires_at = created_at + interval '48 hours'
where expires_at is null;

update public.socio_invites
set consumed_at = used_at
where consumed_at is null and used_at is not null;

update public.socio_invites
set status = case
    when consumed_at is not null then 'consumed'
    when sent_at is not null then 'sent'
    else 'created'
end
where status is null;

update public.socio_invites
set email_status = case
    when sent_at is not null then 'sent'
    else 'pending'
end
where email_status is null;

-- 5. Add user_id to Socios (Idempotent)
alter table public.socios add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.socios add column if not exists password_set boolean default false;

do $$
begin
  if not exists (select 1 from information_schema.table_constraints where constraint_name = 'socios_user_id_key') then
     alter table public.socios add constraint socios_user_id_key unique (user_id);
  end if;
end $$;

-- 6. Indices (Performance & Logic)
create index if not exists idx_socio_invites_socio_id on public.socio_invites(socio_id);
create index if not exists idx_socio_invites_token on public.socio_invites(token);
create index if not exists idx_socios_user_id on public.socios(user_id);

-- Enforce ONE active invite per socio (Unique Partial Index)
-- 'Active' means: not consumed, not expired, and status is created or sent.
-- We approximate expiration check in index using conditional logic if possible, 
-- or simpler: unique socio_id where consumed_at is null. 
-- Let's stick to the simplest robust rule: "One unconsumed invite per socio" is enough to prevent spam, 
-- but effectively we want to allow re-sending if expired. 
-- Indexing complexity with dates in WHERE is tricky. 
-- Let's use a simpler unique constraint on socio_id where status in ('created', 'sent').
-- Note: Requires clearing status to 'expired' or 'superseded' if we want to issue a new one.
-- Or just check it in API layer. 
-- Let's drop constraint logic here to avoid complex index migrations on existing data and handle in API (returning 409).
-- We DO create an index to help find it fast.
create index if not exists idx_socio_invites_active_lookup 
on public.socio_invites (socio_id) 
where consumed_at is null;

-- 7. Helper Function for Computed Status
create or replace function public.socio_invite_status(i public.socio_invites) returns text as $$
begin
  if i.consumed_at is not null then
    return 'consumed';
  end if;
  if i.expires_at < now() then
    return 'expired';
  end if;
  if i.sent_at is not null then
    return 'sent';
  end if;
  return 'created';
end;
$$ language plpgsql stable;

-- 8. View for "Latest Invite Status"
-- We want the most relevant invite for the UI.
create or replace view public.v_socio_latest_invite as
select distinct on (socio_id)
    id,
    socio_id,
    token,
    email,
    created_at,
    sent_at,
    expires_at,
    consumed_at,
    public.socio_invite_status(socio_invites) as computed_status,
    email_status,
    email_provider_id,
    last_error
from public.socio_invites
order by socio_id, created_at desc;
