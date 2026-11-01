-- Step 2C: the final confirmation of the check against the fund database.
-- Run once in the Supabase SQL editor. Safe to re-run.
alter table public.competitor_landscapes
  add column if not exists check_confirmed_at timestamptz,
  add column if not exists check_confirmed_by text;
