-- Client feedback: what a client told Rupert outside the portal (an email, a
-- call), logged by Rupert, with the AI's summary (editable). Shown to the client
-- under What Rupert Knows → What You Told Rupert → Since then (summary only).
-- When it is about a step the client has open, the same id is also in that
-- step's question thread, for answering.
-- Run once in the Supabase SQL editor. Safe to re-run.
create table if not exists public.client_feedback (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  about text not null default 'general' check (about in ('general', 'framing', 'investor_list', 'email_copy')),
  channel text not null check (channel in ('email', 'call', 'message', 'meeting')),
  said_on date not null,
  original text not null,
  summary text,
  logged_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists client_feedback_client on public.client_feedback (client_id, said_on desc) where deleted_at is null;

alter table public.client_feedback enable row level security;

-- Feedback logged on a step before this table existed comes along (same id).
insert into public.client_feedback (id, client_id, about, channel, said_on, original, summary, logged_by, created_at)
select
  (q->>'id')::uuid,
  s.client_id,
  s.step,
  q->'via'->>'channel',
  (q->'via'->>'on')::date,
  q->>'question',
  nullif(q->>'summary', ''),
  q->'via'->>'by',
  coalesce(nullif(q->>'asked_at', '')::timestamptz, now())
from public.setup_steps s
cross join lateral jsonb_array_elements(coalesce(s.published->'questions', '[]'::jsonb)) q
where q ? 'via'
  and s.step in ('framing', 'investor_list', 'email_copy')
  and (q->>'id') ~ '^[0-9a-f-]{36}$'
on conflict (id) do nothing;
