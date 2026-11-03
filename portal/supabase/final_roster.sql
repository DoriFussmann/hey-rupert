-- Step 3: The Final Roster per client. The Dry Match shortlist, plus the
-- funds brought back in 2C, plus the investors added in 2D that pass the
-- Step 1 filters, minus the client's own exclusions (clear matches only).
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.
--
-- One row per Confirm. Reopen stamps cleared_at; nothing is deleted. A
-- client's current Roster is its newest row with cleared_at null.
--
-- entries: [{ firmId, name, website, source: dry|brought_back|added, backed: [competitor], addedStatus, kind }]
-- added_checks: the 2D investors and how each fared (pass, secondary, fail, missing, not_found)
-- exclusion_checks: each exclusion line and its result (excluded, not_on_roster, not_matched)
-- facts: what it was built from { dryListId, landscapeId, dataVersion, exclusions, step2Skipped }
create table if not exists public.final_rosters (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  dry_list_id uuid,
  landscape_id uuid,
  entries jsonb not null,
  fund_ids text[] not null,
  added_checks jsonb not null default '[]'::jsonb,
  exclusion_checks jsonb not null default '[]'::jsonb,
  counts jsonb not null,
  facts jsonb not null,
  confirmed_by text,
  confirmed_at timestamptz not null default now(),
  cleared_by text,
  cleared_at timestamptz
);

create index if not exists final_rosters_client_current
  on public.final_rosters (client_id, confirmed_at desc)
  where cleared_at is null;

-- No policies on purpose: only the service role (server code) reads or writes.
alter table public.final_rosters enable row level security;
