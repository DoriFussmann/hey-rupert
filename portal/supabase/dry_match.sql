-- Dry Match: the confirmed Dry Match Short List per client, the base for the
-- next matching steps. Run once in the Supabase SQL editor before deploying.
-- Safe to re-run.
--
-- One row per Confirm. "Start over" stamps cleared_at; nothing is deleted,
-- so every confirmed list stays on record. A client's current list is its
-- newest row with cleared_at null.
--
-- steps: [{ step, chosen: [ids], chosenLabels: [text], before, removed, left }]
create table if not exists public.dry_match_lists (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  total_funds integer not null,
  steps jsonb not null,
  fund_ids text[] not null,
  fund_count integer not null,
  fund_db_version text,
  taxonomy_revision bigint,
  profile_version text,
  confirmed_by text,
  confirmed_at timestamptz not null default now(),
  cleared_by text,
  cleared_at timestamptz
);

create index if not exists dry_match_lists_client_current
  on public.dry_match_lists (client_id, confirmed_at desc)
  where cleared_at is null;

-- No policies on purpose: only the service role (server code) reads or writes.
alter table public.dry_match_lists enable row level security;
