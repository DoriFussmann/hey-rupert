-- Email Verification: contact checks, corrections on top of the Fund
-- Database, per-client decisions, new leads, and verification runs.
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.
--
-- A contact is identified by its FirmID and its original work email
-- (lowercased), as it appears in the Fund Database workbook.

-- ---------------------------------------------------------------------------
-- Latest verification per contact, shared by every client. Reused for 45
-- days while the email is unchanged. `checked_at` is null while in progress.
create table if not exists public.contact_checks (
  firm_id text not null,
  email_key text not null,
  -- The address that was checked (a corrected email starts a new check).
  email text not null,
  status text
    check (status in ('clean', 'unknown', 'email_bad', 'role_changed', 'not_found', 'left_firm')),
  -- { role: {...}, public: {...}, mailbox: {...} }
  steps jsonb not null default '{}'::jsonb,
  -- { action, email?, firstName?, lastName?, title?, newFirm?, newFirmWebsite?, why }
  suggestion jsonb,
  -- { usd, searches, inputTokens, outputTokens, hunter }
  cost jsonb not null default '{}'::jsonb,
  -- A step failed (API error, missing key): the result is not reused.
  had_error boolean not null default false,
  checked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (firm_id, email_key)
);

create index if not exists contact_checks_checked_at
  on public.contact_checks (checked_at);

alter table public.contact_checks enable row level security;

-- ---------------------------------------------------------------------------
-- Corrections and flags applied on top of the Fund Database for every
-- client. The workbook itself is never edited, so these survive uploads.
--   email / first_name / last_name / title: replace the database value.
--   flag 'removed':   removed for a client; shown as already decided next time.
--   flag 'left_firm': left this fund; hidden from it for every client.
create table if not exists public.contact_corrections (
  firm_id text not null,
  email_key text not null,
  firm_name text not null default '',
  person_name text not null default '',
  email text,
  first_name text,
  last_name text,
  title text,
  flag text check (flag in ('removed', 'left_firm')),
  flag_reason text,
  note text,
  from_client uuid references public.clients(id) on delete set null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (firm_id, email_key)
);

create index if not exists contact_corrections_updated_at
  on public.contact_corrections (updated_at desc);

alter table public.contact_corrections enable row level security;

-- ---------------------------------------------------------------------------
-- Keep / remove decisions for one client. A removed contact is left out of
-- that client's match; the fund's next-best contact moves up.
create table if not exists public.contact_decisions (
  client_id uuid not null references public.clients(id) on delete cascade,
  firm_id text not null,
  email_key text not null,
  decision text not null check (decision in ('keep', 'remove')),
  -- Verification status when the decision was made.
  status text,
  decided_by text,
  decided_at timestamptz not null default now(),
  primary key (client_id, firm_id, email_key)
);

alter table public.contact_decisions enable row level security;

-- ---------------------------------------------------------------------------
-- People who moved to a firm: leads to add to the Fund Database.
create table if not exists public.contact_leads (
  id uuid primary key default gen_random_uuid(),
  person_name text not null default '',
  title text not null default '',
  email text,
  new_firm text not null default '',
  new_firm_website text,
  from_firm_id text not null,
  from_firm_name text not null default '',
  old_email text not null,
  -- [{ url, note }]
  evidence jsonb not null default '[]'::jsonb,
  note text,
  status text not null default 'new' check (status in ('new', 'added', 'dismissed')),
  from_client uuid references public.clients(id) on delete set null,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (from_firm_id, old_email)
);

alter table public.contact_leads enable row level security;

-- ---------------------------------------------------------------------------
-- One verification run per start. `contacts` is the ordered list to check
-- (a snapshot); batches of `batch_size` run in order from `next_batch`.
create table if not exists public.verification_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  scope text not null check (scope in ('all', 'sequence', 'wave1')),
  contacts jsonb not null default '[]'::jsonb,
  -- Contacts reused from earlier checks (same snapshot shape as contacts).
  reused jsonb not null default '[]'::jsonb,
  batch_size integer not null default 5,
  batches integer not null default 0,
  next_batch integer not null default 0,
  status text not null default 'active' check (status in ('active', 'done', 'cancelled')),
  -- { usd, searches, hunter, ms }
  stats jsonb not null default '{}'::jsonb,
  started_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists verification_runs_client
  on public.verification_runs (client_id, created_at desc);

alter table public.verification_runs enable row level security;

-- ---------------------------------------------------------------------------
-- Each run's results as they were when its batch closed (or, for reused
-- contacts, when it started), so a summary stays the same after later runs.
create table if not exists public.verification_results (
  run_id uuid not null references public.verification_runs(id) on delete cascade,
  firm_id text not null,
  email_key text not null,
  email text not null,
  status text,
  steps jsonb not null default '{}'::jsonb,
  suggestion jsonb,
  checked_at timestamptz,
  reused boolean not null default false,
  primary key (run_id, firm_id, email_key)
);

alter table public.verification_results enable row level security;
