-- Rename columns for clarity
alter table clients rename column scope_of_work_content to statement_of_work_content;
alter table clients rename column scope_acknowledged_at to sow_confirmed_at;

-- New onboarding tracking (all admin-set manually)
alter table clients add column nda_signed_at timestamptz;
alter table clients add column intake_completed_at timestamptz;
alter table clients add column payment_received_at timestamptz;

-- Setup phase checklist status (open | wip | done)
alter table clients add column pitch_deck_status text default 'open';
alter table clients add column business_brief_status text default 'open';
alter table clients add column outreach_messaging_status text default 'open';
alter table clients add column investor_match_status text default 'open';
alter table clients add column target_list_status text default 'open';

-- Live campaign checklist status (open | wip | done)
alter table clients add column campaign_analytics_status text default 'open';
alter table clients add column investor_inbox_status text default 'open';
alter table clients add column engagement_tracker_status text default 'open';

-- Expand stage values (no constraint currently enforced, but document the set):
-- 'sow' | 'service_order' | 'nda' | 'intake' | 'payment' | 'setup' | 'live'
update clients set stage = 'sow' where stage = 'scope_of_work';
update notifications set type = 'sow_confirmed' where type = 'scope_acknowledged';
