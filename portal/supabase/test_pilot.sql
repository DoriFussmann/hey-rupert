-- Test pilot clients, automatic Stripe Setup Fee invoices, client feedback
-- checkboxes, and server-only roles.
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.

-- Test pilot: an internal test client. Client steps can be completed from the
-- admin page, and its client emails and reminders are off.
alter table public.clients
  add column if not exists is_test_pilot boolean not null default false;

-- Company website (used by the intake, the test pilot auto-fill and matching).
alter table public.clients
  add column if not exists company_website text;

-- The Stripe invoice created automatically for the Setup Fee.
alter table public.clients
  add column if not exists stripe_invoice_id text;

-- Recommendations the client ticked as done on Analysis & Feedback:
-- { "<item id>": "<ticked at>" }.
alter table public.setup_steps
  add column if not exists client_checks jsonb not null default '{}'::jsonb;

-- Roles now come only from app_metadata (users cannot edit it themselves).
-- Copy any role that was stored only in user_metadata, so nobody loses access.
update auth.users
set raw_app_meta_data =
  coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('role', raw_user_meta_data ->> 'role')
where raw_user_meta_data ->> 'role' in ('admin', 'client')
  and coalesce(raw_app_meta_data ->> 'role', '') = '';
