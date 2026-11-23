-- Go Live in two steps (lib/outreach/launch.ts): "Add leads (paused)", then
-- "Activate". The add is claimed before any lead goes to Instantly, so a
-- repeated or failed click can never add a second first batch, and Build is
-- refused once leads are in Instantly. Safe to run more than once.
alter table public.outreach_campaigns
  add column if not exists leads_adding_at timestamptz,
  add column if not exists leads_added_at timestamptz,
  add column if not exists leads_added_count integer,
  add column if not exists leads_add_note text;

comment on column public.outreach_campaigns.leads_adding_at is 'Go Live step 1 claimed (set before any lead goes to Instantly).';
comment on column public.outreach_campaigns.leads_added_at is 'Go Live step 1 done: the first batch is in the paused Instantly campaign. Final.';
comment on column public.outreach_campaigns.leads_added_count is 'Leads recorded as added by Go Live step 1.';
comment on column public.outreach_campaigns.leads_add_note is 'What happened when step 1 stopped partway, if it did.';
