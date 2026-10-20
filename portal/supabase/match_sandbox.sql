-- Match Sandbox: one hidden internal company used to test Rupert Match from
-- the Fund Database page. It is a test pilot client (emails paused) that never
-- shows in the client list, dashboards or the timeline.
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.
-- Needs portal/supabase/test_pilot.sql (is_test_pilot) to have run first.

alter table public.clients
  add column if not exists is_match_sandbox boolean not null default false;

-- At most one sandbox.
create unique index if not exists clients_one_match_sandbox
  on public.clients ((true))
  where is_match_sandbox;
