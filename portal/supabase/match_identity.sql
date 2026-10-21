-- Four-tier matching (Phase 3, Sprint 3B-1): admin decisions on firm identity.
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.
-- Requires match_tiers.sql (it reuses match_runs_immutable()).
--
-- A decision says whether records of the Fund Database are one firm:
--   confirmed: show the group once per list (duplicates need this)
--   rejected:  keep the records separate (offices apply unless rejected)
-- The decision stores the exact records it was made for. If the provider data
-- later puts different records in the group, the decision no longer applies
-- and the group waits for a new decision. Provider data is never changed.

create table if not exists public.match_identity_groups (
  group_key text primary key,
  kind text not null check (kind in ('duplicate', 'offices')),
  level text not null,
  status text not null check (status in ('confirmed', 'rejected')),
  member_ids text[] not null check (cardinality(member_ids) >= 2),
  -- The records as they were when decided: ids, names, websites, countries, contacts.
  evidence jsonb not null default '{}'::jsonb,
  note text not null default '',
  decided_by text,
  decided_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.match_identity_groups enable row level security;

-- Every decision, with the row before and after and who made it. Append-only.
create table if not exists public.match_identity_changes (
  id bigserial primary key,
  group_key text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  before jsonb,
  after jsonb,
  actor text,
  at timestamptz not null default now()
);

create index if not exists match_identity_changes_group on public.match_identity_changes (group_key, id desc);
alter table public.match_identity_changes enable row level security;

create or replace function public.match_identity_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.match_identity_changes (group_key, action, before, after, actor)
  values (
    coalesce(new.group_key, old.group_key),
    lower(tg_op),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    case when tg_op = 'DELETE' then old.updated_by else new.updated_by end
  );
  return null;
end;
$$;

revoke all on function public.match_identity_log() from public, anon, authenticated;

drop trigger if exists match_identity_groups_log on public.match_identity_groups;
create trigger match_identity_groups_log after insert or update or delete on public.match_identity_groups
  for each row execute function public.match_identity_log();

drop trigger if exists match_identity_changes_no_change on public.match_identity_changes;
create trigger match_identity_changes_no_change before update or delete on public.match_identity_changes
  for each row execute function public.match_runs_immutable();
drop trigger if exists match_identity_changes_no_truncate on public.match_identity_changes;
create trigger match_identity_changes_no_truncate before truncate on public.match_identity_changes
  for each statement execute function public.match_runs_immutable();
revoke update, delete, truncate on public.match_identity_changes from public, anon, authenticated, service_role;
