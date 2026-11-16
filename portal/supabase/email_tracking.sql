-- Email tracking: delivered, opened, clicked and bounced for client emails.
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.
-- Until it is run, emails still send and log as before, without tracking.

-- Resend's id for each email, whether it was sent from the tracked sender,
-- and what Resend has reported about it since.
alter table public.email_log
  add column if not exists resend_id text,
  add column if not exists tracked boolean not null default false,
  add column if not exists delivered_at timestamptz,
  add column if not exists first_opened_at timestamptz,
  add column if not exists last_opened_at timestamptz,
  add column if not exists open_count integer not null default 0,
  add column if not exists first_clicked_at timestamptz,
  add column if not exists click_count integer not null default 0,
  add column if not exists bounced_at timestamptz;

create index if not exists email_log_resend_id_idx
  on public.email_log (resend_id)
  where resend_id is not null;

-- Every event Resend reports, one row per webhook delivery. The columns on
-- email_log are worked out from these rows, so a late, repeated or
-- out-of-order event can never leave them wrong.
create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  -- Svix's id for the delivery: a retried webhook is stored once.
  webhook_id text not null unique,
  resend_id text not null,
  type text not null check (type in ('delivered', 'opened', 'clicked', 'bounced', 'complained')),
  occurred_at timestamptz not null,
  link text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists email_events_resend_id_idx
  on public.email_events (resend_id, occurred_at);

-- No policies on purpose: only the service role (server code) reads or writes.
alter table public.email_events enable row level security;
