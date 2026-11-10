-- View-only portal logins ("viewers") that a client asked to be added.
-- A viewer signs in with their own email and password and sees the client's
-- portal exactly as the client does, but can't change anything.
-- Run once in the Supabase SQL editor before deploying the viewers feature.
create table if not exists public.client_viewers (
  -- The viewer's own auth user (app_metadata.role = 'viewer').
  id uuid primary key references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text not null,
  -- One-time "set your password" link, like client_password_setups.
  setup_token text unique,
  setup_expires_at timestamptz,
  setup_used_at timestamptz,
  welcome_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists client_viewers_client_id_idx
  on public.client_viewers (client_id);

-- No policies on purpose: only the service role (server code) can read or
-- write viewers.
alter table public.client_viewers enable row level security;
