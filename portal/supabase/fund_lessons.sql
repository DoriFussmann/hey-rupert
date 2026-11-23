-- Lessons for Rupert: fixes to a Fund Database record, made from Matching →
-- Step 2C / 3C ("Lesson for Rupert: the database or taxonomy needs fixing").
-- Each row adds values to one field of one fund (e.g. Geography: United
-- States). The provider file is never edited: the values are added to the
-- fund's record whenever the database is loaded for matching, for every
-- client, and survive a re-upload. Deleting a row removes what it added.
-- Run once in the Supabase SQL editor. Safe to re-run.
create table if not exists public.fund_lessons (
  id uuid primary key default gen_random_uuid(),
  -- The Fund Database record (FirmID).
  firm_id text not null,
  -- The Step 1 filter the values belong to.
  field text not null check (field in ('financing', 'stage', 'geography', 'sector')),
  -- Taxonomy labels added to the fund for that field.
  labels text[] not null default '{}',
  -- Why: the admin's note (what the fund's own website says).
  note text not null default '',
  -- Where it was found.
  found_for_client uuid references public.clients(id) on delete set null,
  landscape_id uuid references public.competitor_landscapes(id) on delete set null,
  investor_name text not null default '',
  recorded_by text,
  recorded_at timestamptz not null default now(),
  unique (firm_id, field)
);

-- No policies on purpose: only the service role (server code) reads or writes.
alter table public.fund_lessons enable row level security;
