create table if not exists public.htmlquizlab_state (
  key text primary key,
  value jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint htmlquizlab_state_known_key check (key in ('users', 'quizzes'))
);

alter table public.htmlquizlab_state enable row level security;

drop policy if exists "HTML Quiz Lab state is publicly readable" on public.htmlquizlab_state;
drop policy if exists "HTML Quiz Lab state is publicly insertable" on public.htmlquizlab_state;
drop policy if exists "HTML Quiz Lab state is publicly updatable" on public.htmlquizlab_state;

create policy "HTML Quiz Lab state is publicly readable"
  on public.htmlquizlab_state
  for select
  using (true);

create policy "HTML Quiz Lab state is publicly insertable"
  on public.htmlquizlab_state
  for insert
  with check (key in ('users', 'quizzes'));

create policy "HTML Quiz Lab state is publicly updatable"
  on public.htmlquizlab_state
  for update
  using (key in ('users', 'quizzes'))
  with check (key in ('users', 'quizzes'));

grant select, insert, update on public.htmlquizlab_state to anon;

insert into public.htmlquizlab_state (key, value)
values
  ('users', '[]'::jsonb),
  ('quizzes', '[]'::jsonb)
on conflict (key) do nothing;
