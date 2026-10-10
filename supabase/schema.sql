create table if not exists public.pinscrap_api_keys (
  id uuid primary key,
  name text not null check (char_length(name) between 1 and 80),
  key_prefix text not null,
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table public.pinscrap_api_keys enable row level security;
revoke all on public.pinscrap_api_keys from anon, authenticated;
grant select, insert, update on public.pinscrap_api_keys to service_role;
