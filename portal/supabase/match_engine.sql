-- Four-tier matching (Phase 3, Sprint 3B-2): the global match engine switch.
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.
-- Requires match_tiers.sql (it reuses match_runs_immutable()).
--
-- One setting for every client: which engine the Match page, verification and
-- Push to client use.
--   current:   the current engine (three tiers). The default: no row means current.
--   four_tier: the four-tier engine (Core, Sphere, Tier 3, Tier 4).
-- Switching never changes a saved run, a pushed list or a list already sent:
-- each list keeps the tiers it was sent with.

create table if not exists public.match_engine_setting (
  id text primary key default 'global' check (id = 'global'),
  engine text not null check (engine in ('current', 'four_tier')),
  note text not null default '',
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.match_engine_setting enable row level security;

-- Every switch, with the setting before and after and who made it. Append-only.
create table if not exists public.match_engine_changes (
  id bigserial primary key,
  action text not null check (action in ('insert', 'update', 'delete')),
  before jsonb,
  after jsonb,
  actor text,
  at timestamptz not null default now()
);

alter table public.match_engine_changes enable row level security;

create or replace function public.match_engine_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.match_engine_changes (action, before, after, actor)
  values (
    lower(tg_op),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    case when tg_op = 'DELETE' then old.updated_by else new.updated_by end
  );
  return null;
end;
$$;

revoke all on function public.match_engine_log() from public, anon, authenticated;

drop trigger if exists match_engine_setting_log on public.match_engine_setting;
create trigger match_engine_setting_log after insert or update or delete on public.match_engine_setting
  for each row execute function public.match_engine_log();

drop trigger if exists match_engine_changes_no_change on public.match_engine_changes;
create trigger match_engine_changes_no_change before update or delete on public.match_engine_changes
  for each row execute function public.match_runs_immutable();
drop trigger if exists match_engine_changes_no_truncate on public.match_engine_changes;
create trigger match_engine_changes_no_truncate before truncate on public.match_engine_changes
  for each statement execute function public.match_runs_immutable();
revoke update, delete, truncate on public.match_engine_changes from public, anon, authenticated, service_role;
