-- Two-step launch: the client approves the launch, Rupert clicks Go Live.
-- See lib/outreach/live-server.ts (requestLaunch, goLive).
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.
-- Needs outreach_live.sql.

alter table public.outreach_campaigns
  add column if not exists launch_requested_at timestamptz,
  add column if not exists launch_requested_by text;
