-- Setup phase Turn Engine + client reminders.
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.

-- One row per client per Setup step:
--   materials      client uploads deck / pastes company text, then submits
--   deck_review    Rupert's comments on the deck and materials
--   framing        message framing: Rupert publishes, client confirms
--   investor_list  matched investors (CSV): Rupert publishes, client confirms
--   email_copy     3 tiers x 3 emails: Rupert publishes, client confirms
create table if not exists public.setup_steps (
  client_id uuid not null references public.clients(id) on delete cascade,
  step text not null
    check (step in ('materials', 'deck_review', 'framing', 'investor_list', 'email_copy')),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'published', 'with_client', 'changes_requested', 'confirmed')),
  -- Work in progress: Rupert's draft, or the client's draft for materials.
  draft jsonb not null default '{}'::jsonb,
  -- What the client sees (or, for materials, what the client submitted).
  published jsonb,
  version integer not null default 0,
  published_at timestamptz,
  -- Latest client decision: { decision, note, item_notes, version, at }
  response jsonb,
  -- Every published round with the client's response: [{ version, published_at, response }]
  history jsonb not null default '[]'::jsonb,
  -- When the current turn began (drives reminders).
  turn_since timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (client_id, step)
);

-- No policies on purpose: only the service role (server code) reads or
-- writes Setup steps.
alter table public.setup_steps enable row level security;

-- Reminder log: one row per client per turn ("nda", "intake",
-- "setup:materials", …). turn_since identifies the turn; when it changes
-- (re-pushed), the count starts again.
create table if not exists public.turn_reminders (
  client_id uuid not null references public.clients(id) on delete cascade,
  turn_key text not null,
  turn_since timestamptz not null,
  sent_count integer not null default 0,
  last_sent_at timestamptz,
  stalled_alert_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (client_id, turn_key)
);

alter table public.turn_reminders enable row level security;

-- Private bucket for client uploads (pitch decks, materials). 50 MB per
-- file. Files are uploaded with one-time signed URLs issued by the server
-- and downloaded by admins with short-lived signed URLs, so no storage
-- policies are needed.
insert into storage.buckets (id, name, public, file_size_limit)
values ('client-materials', 'client-materials', false, 52428800)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit;

-- Clients already past intake start Setup at the materials step.
update public.clients
  set stage = 'setup'
  where intake_completed_at is not null
    and (stage is null or stage in ('nda', 'intake'));
