-- CSV contact imports: contacts added to the Fund Database from a CSV. They
-- are kept so they go back on top of every new provider workbook. Each
-- database version also records where it came from (workbook or CSV), for
-- the Database history on the Fund Database page.
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.
-- Needs portal/supabase/rupert_match.sql to have run first.

alter table public.fund_db_versions
  add column if not exists source text not null default 'workbook'
    check (source in ('workbook', 'csv'));

-- ---------------------------------------------------------------------------
-- One row per CSV. "staged" waits for Apply in the preview; "applied" is part
-- of the database (and of every later workbook).
create table if not exists public.contact_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  -- The CSV as uploaded, in the private fund-database bucket.
  upload_path text not null,
  status text not null default 'staged'
    check (status in ('staged', 'applied')),
  -- Contacts to add, in the Fund Database's contact shape.
  contacts jsonb not null default '[]'::jsonb,
  -- { rows, added, duplicates, rejectedCount, rejected: [{ row, reason }], sample }
  summary jsonb not null default '{}'::jsonb,
  -- The database version Apply created.
  version_id uuid references public.fund_db_versions(id) on delete set null,
  created_by text,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create index if not exists contact_imports_status
  on public.contact_imports (status, applied_at);

alter table public.contact_imports enable row level security;
