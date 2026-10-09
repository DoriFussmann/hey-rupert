-- One-time "set your password" links for client portal logins.
-- Run once in the Supabase SQL editor before deploying the setup-link flow.
create table if not exists public.client_password_setups (
  client_id uuid primary key references public.clients(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- No policies on purpose: only the service role (server code) can read or
-- write setup links.
alter table public.client_password_setups enable row level security;
