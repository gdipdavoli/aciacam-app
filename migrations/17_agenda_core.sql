-- Migration: 17_agenda_core
-- Description: Create tables for Agenda Agent (Slots & Config) and update Pedidos

-- 1. Create pickup_config table (Recurrence Rules)
create table if not exists public.pickup_config (
    id uuid not null default gen_random_uuid() primary key,
    day_of_week integer not null check (day_of_week between 0 and 6), -- 0=Sunday, 6=Saturday
    start_time time not null,
    end_time time not null,
    capacity integer not null default 1,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    
    constraint pickup_config_time_check check (end_time > start_time)
);

-- 2. Create pickup_slots table (Actual available slots)
create table if not exists public.pickup_slots (
    id uuid not null default gen_random_uuid() primary key,
    start_time timestamptz not null,
    end_time timestamptz not null,
    capacity integer not null default 1,
    status text not null default 'active' check (status in ('active', 'cancelled', 'moved')),
    
    -- Optional: We can add a 'source_rule_id' if we want to track which config generated this
    source_config_id uuid references public.pickup_config(id) on delete set null,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint pickup_slots_time_check check (end_time > start_time)
);

-- Index for searching slots by date range
create index idx_pickup_slots_range on public.pickup_slots(start_time, end_time);

-- 3. Update Pedidos table
alter table public.pedidos 
    add column if not exists slot_id uuid references public.pickup_slots(id) on delete set null,
    add column if not exists requires_rescheduling boolean not null default false;

create index idx_pedidos_slot_id on public.pedidos(slot_id);

-- 4. Enable RLS
alter table public.pickup_config enable row level security;
alter table public.pickup_slots enable row level security;

-- 5. RLS Policies

-- CONFIG: Only Admin/Staff can manage. Everyone (implicit in backend, but maybe restricted) can read? 
-- Actually only Admin/Staff needs to read config.
create policy "Admin/Staff can manage pickup_config"
on public.pickup_config
for all
using (
    exists (
        select 1 from public.socios
        where user_id = auth.uid()
        and rol in ('admin', 'staff')
    )
);

-- SLOTS:
-- Admin/Staff: Full access
create policy "Admin/Staff can manage pickup_slots"
on public.pickup_slots
for all
using (
    exists (
        select 1 from public.socios
        where user_id = auth.uid()
        and rol in ('admin', 'staff')
    )
);

-- Socios: Can read 'active' slots only (for selection)
create policy "Socios can view active slots"
on public.pickup_slots
for select
using (
    status = 'active'
);

-- 6. Trigger to update updated_at (standard practice)
-- (Assuming we have a generic update_updated_at_column function, if not we create simple ones or skip)
-- I'll skip adding trigger definition explicitly if not sure it exists, but usually good to have.
