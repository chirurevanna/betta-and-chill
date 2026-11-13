-- Betta & Chill: one shared total of heart taps across all visitors.
-- Run once in Supabase → SQL Editor. Seats and bench stations need no tables (they use Realtime presence).

create table if not exists public.heart_total (
  id int primary key default 1 check (id = 1),
  total bigint not null default 0
);
insert into public.heart_total (id) values (1) on conflict (id) do nothing;

-- Row level security with no policies: anonymous visitors can't read or write the table directly.
alter table public.heart_total enable row level security;

-- The only way in: add 0–50 taps per call (0 just reads the total). Runs with the owner's rights,
-- so nobody can set, lower or wipe the total.
create or replace function public.add_hearts(n int)
returns bigint
language sql
security definer
set search_path = public
as $$
  update heart_total set total = total + greatest(0, least(n, 50)) where id = 1 returning total;
$$;

revoke all on function public.add_hearts(int) from public;
grant execute on function public.add_hearts(int) to anon, authenticated;
