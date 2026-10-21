-- Company profiles (Phase 2): every version of a client's canonical company
-- profile (sector, stage and geography as investor-taxonomy categories, with
-- the founder evidence behind them), and which intake interviews use the
-- sector classification guide.
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.
-- Needs portal/supabase/intake_interviews.sql and investor_taxonomy.sql first.

-- ---------------------------------------------------------------------------
-- Versions are only ever added, never changed, so every match can be traced
-- to the profile it ran on. The saved match profile (match_profiles.answers)
-- is untouched: the current matching engine keeps running on it.
create table if not exists public.company_profile_versions (
  client_id uuid not null references public.clients(id) on delete cascade,
  version integer not null check (version > 0),
  -- The canonical profile (lib/company-profile/core.ts, schema 1).
  profile jsonb not null,
  readiness text not null check (readiness in ('blocked', 'limited', 'ready')),
  source text not null check (source in ('intake_ai', 'admin_edit', 'admin_confirm', 'legacy')),
  taxonomy_revision bigint not null default 0,
  note text not null default '',
  created_by text,
  created_at timestamptz not null default now(),
  primary key (client_id, version)
);

alter table public.company_profile_versions enable row level security;

-- ---------------------------------------------------------------------------
-- Interviews that use the sector classification guide (1) or not (null).
-- New interviews use it. So do existing ones the founder has not answered yet.
-- Interviews already under way keep their original behavior to the end.
alter table public.intake_interviews
  add column if not exists classification_guide smallint;

alter table public.intake_interviews
  alter column classification_guide set default 1;

update public.intake_interviews
set classification_guide = 1
where classification_guide is null
  and client_message_count = 0;
