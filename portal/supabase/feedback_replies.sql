-- Rupert's reply to each point of feedback on a review step (Outreach
-- Narrative, Investor Matching, Email Copy). One row per point: the point as
-- it was written (by the client, or by a viewer), Rupert's working reply and
-- status, and what he last sent. Nothing shows to the client until "Respond".
-- Run once in the Supabase SQL editor before deploying feedback replies.
create table if not exists public.feedback_replies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  step text not null check (step in ('framing', 'investor_list', 'email_copy')),
  version integer not null,
  -- Stable id of the point: derived from the client's answer, or the viewer comment's id.
  point_id text not null,
  source text not null check (source in ('client', 'viewer')),
  author text not null,
  label text not null default '',
  point text not null,
  -- Where the point sits in the feedback as it was given, to list replies in that order.
  position integer not null default 0,
  -- Rupert's working copy.
  reply text not null default '',
  status text not null default 'open' check (status in ('open', 'changed', 'not_changing', 'needs_input')),
  -- What the client sees: set by "Respond".
  published_reply text,
  published_status text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, step, point_id)
);

create index if not exists feedback_replies_client_step_idx
  on public.feedback_replies (client_id, step, version);

-- No policies on purpose: only the service role (server code) reads or writes.
alter table public.feedback_replies enable row level security;
