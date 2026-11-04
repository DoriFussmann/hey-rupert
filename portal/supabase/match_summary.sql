-- Finalize (closes the matching), the matching summary and the Competitive
-- Landscape Overview, and Push to Client (to the client's admin page, not
-- the client's portal). Run once in the Supabase SQL editor. Safe to re-run.
--
-- match_finalizations: one row per Finalize; Reopen matching stamps cleared_at.
--   matching / landscape: the summaries as they stood, { kind, title, clientName, steps: [...] }.
-- client_deliverables: what was pushed to the client page; a new push of the same kind replaces it.
create table if not exists public.match_finalizations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  plan_id uuid,
  matching jsonb not null,
  landscape jsonb,
  finalized_by text,
  finalized_at timestamptz not null default now(),
  cleared_by text,
  cleared_at timestamptz
);

create index if not exists match_finalizations_client_current
  on public.match_finalizations (client_id, finalized_at desc)
  where cleared_at is null;

alter table public.match_finalizations enable row level security;

create table if not exists public.client_deliverables (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('matching', 'landscape')),
  content jsonb not null,
  finalization_id uuid,
  pushed_by text,
  pushed_at timestamptz not null default now(),
  cleared_by text,
  cleared_at timestamptz
);

create index if not exists client_deliverables_client_current
  on public.client_deliverables (client_id, kind)
  where cleared_at is null;

-- No policies on purpose: only the service role (server code) reads or writes.
alter table public.client_deliverables enable row level security;
