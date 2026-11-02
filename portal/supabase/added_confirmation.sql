-- Step 2D: confirming Try and Add to DB (what wasn't added is skipped).
-- Run once in the Supabase SQL editor. Safe to re-run.
alter table public.competitor_landscapes
  add column if not exists added_confirmed_at timestamptz,
  add column if not exists added_confirmed_by text;
