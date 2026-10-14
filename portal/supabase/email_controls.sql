-- Email controls, email log, per-client pause and the "went live" date.
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.

-- Admin overrides for every email the portal sends. Only edited rows are
-- stored; anything missing falls back to the defaults in lib/email-templates.ts.
--   key "client:<turn>"            email to the client when it is their turn
--   key "admin:<event>"            email to Rupert about client activity
--   key "reminder"                 the reminder email (wording)
--   key "signature"                sign-off used by every client email (body)
--   key "reminder_timing:<turn>"   reminder schedule for one step (config)
create table if not exists public.email_settings (
  key text primary key,
  enabled boolean,
  subject text,
  body text,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- No policies on purpose: only the service role (server code) reads or writes.
alter table public.email_settings enable row level security;

-- Every email sent to a client: automatic, reminder or written by Rupert.
create table if not exists public.email_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete cascade,
  kind text not null check (kind in ('automatic', 'reminder', 'manual')),
  template_key text,
  recipients text[] not null default '{}',
  subject text not null,
  body text not null,
  status text not null check (status in ('sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists email_log_client_created_idx
  on public.email_log (client_id, created_at desc);

alter table public.email_log enable row level security;

-- Per-client switch: stops automatic emails and reminders to this client.
alter table public.clients
  add column if not exists emails_paused boolean not null default false;

-- When the client first moved to the Live stage (timeline). Clients already
-- live before this script stay null and show "date unknown".
alter table public.clients
  add column if not exists live_at timestamptz;

create or replace function public.set_client_live_at()
returns trigger
language plpgsql
as $$
begin
  if new.stage = 'live'
     and new.live_at is null
     and (tg_op = 'INSERT' or old.stage is distinct from 'live') then
    new.live_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists clients_set_live_at on public.clients;
create trigger clients_set_live_at
  before insert or update of stage on public.clients
  for each row execute function public.set_client_live_at();
