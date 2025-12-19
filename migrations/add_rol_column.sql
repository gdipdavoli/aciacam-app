-- Add rol column to socios table
alter table public.socios add column rol text default 'member';
