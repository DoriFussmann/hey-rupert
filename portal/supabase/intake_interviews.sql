-- AI Intake Interviewer: one interview per client.
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.

create table if not exists public.intake_interviews (
  client_id uuid primary key references public.clients(id) on delete cascade,
  -- [{ role: "assistant" | "user", content: text, at: timestamptz }]
  messages jsonb not null default '[]'::jsonb,
  -- { <topic id>: { status: "missing" | "partial" | "covered", note: text } }
  topic_status jsonb not null default '{}'::jsonb,
  -- [{ topic_id, title, answer }] once the summary is written
  summary jsonb,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'review', 'completed')),
  client_message_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

-- No policies on purpose: only the service role (server code) reads or
-- writes interviews.
alter table public.intake_interviews enable row level security;
