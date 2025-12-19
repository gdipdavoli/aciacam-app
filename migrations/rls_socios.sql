-- Enable RLS
alter table public.socios enable row level security;

-- Drop existing policy if it exists to avoid conflicts
drop policy if exists "Socio can read own record" on public.socios;

-- Create policy for selecting own record
create policy "Socio can read own record"
on public.socios
for select
using (auth.uid() = user_id);
