-- AI agents in Setup: intake summary, client-viewed feedback.
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.

-- Rupert's internal intake summary, written by the AI and editable:
-- { summary, industry, geography, stage, raise_amount, generated_at,
--   based_on, edited_at }
alter table public.intake_interviews
  add column if not exists admin_brief jsonb;

-- First time the client opened the current version of a step (used for the
-- Analysis & Feedback step: Rupert is notified once per version).
alter table public.setup_steps
  add column if not exists client_viewed_at timestamptz;

-- Make the new columns visible to the API right away.
notify pgrst, 'reload schema';
