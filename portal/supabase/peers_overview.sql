-- Peers Landscape Overview: its own summary on the finalization, and its own pushed deliverable.
alter table public.match_finalizations add column if not exists peers jsonb;
alter table public.client_deliverables drop constraint if exists client_deliverables_kind_check;
alter table public.client_deliverables add constraint client_deliverables_kind_check check (kind in ('matching','landscape','peers'));
