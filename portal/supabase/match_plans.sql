-- Step 4: The Plan per client. The confirmed Final Roster in tiers (Core,
-- Sphere, Tier 3, Tier 4), ranked inside each tier, and the funds and
-- contacts the campaign can reach (the Final Outreach Roster).
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.
--
-- One row per Confirm. Reopen stamps cleared_at; nothing is deleted. A
-- client's current Plan is its newest row with cleared_at null.
--
-- inputs: { inboxes, emailsPerInboxPerDay, sendingDaysPerWeek, warmupWeeks, warmupPercent, followUps, followUpDelayDays, contactsPerFund, months }
-- capacity: { contacts, emailsPerContact, sends, scheduled, dailyNormal, dailyWarmup, days, notes }
-- planned: the Final Outreach Roster, in order: [{ firmId, tier, rank, slots }]
-- funds: every Roster fund with its tier, rank, look-alike, focus and contacts (Step 5 refills from here)
-- facts: { rosterId, dataVersion, taxonomyRevision, subSectors }
create table if not exists public.match_plans (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  roster_id uuid,
  inputs jsonb not null,
  capacity jsonb not null,
  counts jsonb not null,
  planned jsonb not null,
  fund_ids text[] not null,
  funds jsonb not null default '[]'::jsonb,
  facts jsonb not null,
  confirmed_by text,
  confirmed_at timestamptz not null default now(),
  cleared_by text,
  cleared_at timestamptz
);

create index if not exists match_plans_client_current
  on public.match_plans (client_id, confirmed_at desc)
  where cleared_at is null;

-- No policies on purpose: only the service role (server code) reads or writes.
alter table public.match_plans enable row level security;
