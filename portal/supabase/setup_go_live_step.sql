-- Setup step 4, Go Live (Oct 26 2026): Rupert pushes it to the client with the
-- first monthly invoice; the client connects their inbox, pays and clicks
-- Go Live, which confirms the step. Lets setup_steps hold the new step.
-- Run once in the Supabase SQL editor. Safe to run again.

alter table public.setup_steps drop constraint if exists setup_steps_step_check;
alter table public.setup_steps
  add constraint setup_steps_step_check
  check (step in ('materials', 'deck_review', 'framing', 'investor_list', 'email_copy', 'go_live'));
