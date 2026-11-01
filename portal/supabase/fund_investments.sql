-- Investments in the Fund Database: which fund invested in which company,
-- found while researching a client's competitors (Matching → Step 2). A fact
-- about the fund's portfolio, company-wide; it never changes the fund's
-- stated sectors. Run once in the Supabase SQL editor. Safe to re-run.
create table if not exists public.fund_investments (
  id uuid primary key default gen_random_uuid(),
  -- The Fund Database record (FirmID).
  firm_id text not null,
  investor_name text not null,
  company text not null,
  company_website text not null default '',
  company_sectors text[] not null default '{}',
  round text not null default '',
  lead boolean not null default false,
  source_url text not null default '',
  -- Where it was found.
  found_for_client uuid references public.clients(id) on delete set null,
  landscape_id uuid references public.competitor_landscapes(id) on delete set null,
  recorded_by text,
  recorded_at timestamptz not null default now(),
  -- One row per fund, company and round, whatever the spelling case.
  company_key text generated always as (lower(company)) stored,
  round_key text generated always as (lower(round)) stored
);

create unique index if not exists fund_investments_unique
  on public.fund_investments (firm_id, company_key, round_key);
create index if not exists fund_investments_firm on public.fund_investments (firm_id);

-- No policies on purpose: only the service role (server code) reads or writes.
alter table public.fund_investments enable row level security;
