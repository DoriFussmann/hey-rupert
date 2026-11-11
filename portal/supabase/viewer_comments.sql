-- Comments a view-only viewer leaves on a review step (Outreach Narrative,
-- Investor Matching, Email Copy). A viewer still can't change anything: a
-- comment is a note for Rupert and the client, shown with the viewer's name.
-- Run once in the Supabase SQL editor before deploying viewer comments.
create table if not exists public.viewer_comments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  -- Kept when the viewer is removed, so the comment stays in the record.
  viewer_id uuid references public.client_viewers(id) on delete set null,
  -- The viewer's name when they wrote it.
  viewer_name text not null,
  step text not null check (step in ('framing', 'investor_list', 'email_copy')),
  -- The version of the step the viewer was looking at.
  version integer not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists viewer_comments_client_step_idx
  on public.viewer_comments (client_id, step, created_at);

-- No policies on purpose: only the service role (server code) reads or writes.
alter table public.viewer_comments enable row level security;
