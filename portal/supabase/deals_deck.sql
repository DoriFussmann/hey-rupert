-- Competitive Landscape & Deals: a short slide deck prepared for one client,
-- shown from a button at the bottom of the client's Investor Matching page.
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- client_deal_decks: one current row per client (cleared_at is null); a new
--   deck replaces the old one by stamping its cleared_at.
--   content: { title, slides: [...] }, the shape in portal/lib/match/deals/core.ts.
--   A client with no row sees no button.
create table if not exists public.client_deal_decks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  content jsonb not null,
  created_by text,
  created_at timestamptz not null default now(),
  cleared_by text,
  cleared_at timestamptz
);

create index if not exists client_deal_decks_client_current
  on public.client_deal_decks (client_id, created_at desc)
  where cleared_at is null;

-- No policies on purpose: only the service role (server code) reads or writes.
alter table public.client_deal_decks enable row level security;
