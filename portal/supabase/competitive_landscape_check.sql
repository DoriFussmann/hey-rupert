-- Step 2C: decisions on the confirmed investors checked against the Fund
-- Database. Run once in the Supabase SQL editor before deploying, after
-- competitive_landscape_investors.sql. Safe to re-run.
--
-- investor_decisions: { <investor id>: { firmId (a Fund Database record, or
--   null: not in the database), action: "bring_back" | "leave_out",
--   note, lesson (the database or taxonomy needs fixing), by, at } }
alter table public.competitor_landscapes
  add column if not exists investor_decisions jsonb not null default '{}'::jsonb;
