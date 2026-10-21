-- Four-tier matching (Phase 3, Sprint 3A): saved match runs, their fund-level
-- results, fund-of-funds exceptions and Match Sandbox reset markers.
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.
--
-- Saved runs and results are permanent. Triggers reject every update, delete
-- and truncate, for every role. The app's roles have no write access to the
-- two tables at all: they save through two functions that only add rows.
-- (The database owner, working in the SQL editor, can still drop a trigger;
-- nothing inside the database can prevent that.)

-- ---------------------------------------------------------------------------
-- Saved match runs. Not tied to the client by a foreign key, so a run
-- survives the client's deletion (shown as "deleted client") and Match
-- Sandbox resets (kept as a sandbox run).
create table if not exists public.match_runs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  client_name text not null,
  is_sandbox boolean not null default false,
  engine text not null check (engine in ('legacy', 'tiers')),
  rules_version text not null,
  -- Both runs of one comparison share it.
  comparison_id uuid,
  -- Null: a legacy profile with no saved version.
  profile_version integer,
  -- The profile as matched: category ids, labels, readiness and warnings.
  profile_inputs jsonb not null,
  taxonomy_revision bigint not null,
  fund_db_version text not null,
  fund_db_file text not null default '',
  -- Settings the run used (filters, website check depth).
  settings jsonb not null default '{}'::jsonb,
  counts jsonb not null,
  results_expected integer not null check (results_expected >= 0),
  ran_by text,
  ran_at timestamptz not null default now()
);

create index if not exists match_runs_client on public.match_runs (client_id, ran_at desc);
create index if not exists match_runs_comparison on public.match_runs (comparison_id);
alter table public.match_runs enable row level security;

-- One row per fund per run.
create table if not exists public.match_run_results (
  run_id uuid not null references public.match_runs (id),
  firm_id text not null,
  firm_name text not null,
  status text not null check (status in ('tiered', 'excluded', 'unresolved', 'generalist')),
  -- tiers engine: core | sphere | tier3 | tier4; legacy engine: bullseye | match | expansion.
  tier text,
  reason_codes text[] not null default '{}',
  detail jsonb not null default '{}'::jsonb,
  score numeric,
  position integer not null,
  primary key (run_id, firm_id)
);

create index if not exists match_run_results_status on public.match_run_results (run_id, status, tier);
alter table public.match_run_results enable row level security;

create or replace function public.match_runs_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Saved match runs and their results cannot be changed or deleted.'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists match_runs_no_change on public.match_runs;
create trigger match_runs_no_change before update or delete on public.match_runs
  for each row execute function public.match_runs_immutable();
drop trigger if exists match_runs_no_truncate on public.match_runs;
create trigger match_runs_no_truncate before truncate on public.match_runs
  for each statement execute function public.match_runs_immutable();
drop trigger if exists match_run_results_no_change on public.match_run_results;
create trigger match_run_results_no_change before update or delete on public.match_run_results
  for each row execute function public.match_runs_immutable();
drop trigger if exists match_run_results_no_truncate on public.match_run_results;
create trigger match_run_results_no_truncate before truncate on public.match_run_results
  for each statement execute function public.match_runs_immutable();

revoke all on public.match_runs from public, anon, authenticated, service_role;
revoke all on public.match_run_results from public, anon, authenticated, service_role;
grant select on public.match_runs to service_role;
grant select on public.match_run_results to service_role;

-- Starts a run: the run row, with how many result rows it will have.
create or replace function public.match_begin_run(p_run jsonb, p_expected integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into public.match_runs (
    client_id, client_name, is_sandbox, engine, rules_version, comparison_id,
    profile_version, profile_inputs, taxonomy_revision, fund_db_version,
    fund_db_file, settings, counts, results_expected, ran_by
  ) values (
    (p_run->>'client_id')::uuid,
    coalesce(p_run->>'client_name', ''),
    coalesce((p_run->>'is_sandbox')::boolean, false),
    p_run->>'engine',
    p_run->>'rules_version',
    nullif(p_run->>'comparison_id', '')::uuid,
    nullif(p_run->>'profile_version', '')::integer,
    coalesce(p_run->'profile_inputs', '{}'::jsonb),
    (p_run->>'taxonomy_revision')::bigint,
    p_run->>'fund_db_version',
    coalesce(p_run->>'fund_db_file', ''),
    coalesce(p_run->'settings', '{}'::jsonb),
    coalesce(p_run->'counts', '{}'::jsonb),
    p_expected,
    p_run->>'ran_by'
  )
  returning id into new_id;
  return new_id;
end;
$$;

-- Adds result rows to a run that is still being saved: within 30 minutes of
-- its start and never beyond the number it announced. Rows already saved
-- can't be replaced (the primary key rejects a second row for a fund).
create or replace function public.match_add_results(p_run_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  run_row public.match_runs%rowtype;
  have integer;
  adding integer;
begin
  select * into run_row from public.match_runs where id = p_run_id;
  if not found then
    raise exception 'Match run % does not exist.', p_run_id;
  end if;
  if run_row.ran_at < now() - interval '30 minutes' then
    raise exception 'Match run % is closed: results can only be added while it is being saved.', p_run_id;
  end if;
  adding := jsonb_array_length(p_rows);
  select count(*) into have from public.match_run_results where run_id = p_run_id;
  if have + adding > run_row.results_expected then
    raise exception 'Match run % would have more results than it announced (% + % > %).',
      p_run_id, have, adding, run_row.results_expected;
  end if;
  insert into public.match_run_results (run_id, firm_id, firm_name, status, tier, reason_codes, detail, score, position)
  select
    p_run_id,
    r->>'firm_id',
    coalesce(r->>'firm_name', ''),
    r->>'status',
    nullif(r->>'tier', ''),
    coalesce(array(select jsonb_array_elements_text(r->'reason_codes')), '{}'),
    coalesce(r->'detail', '{}'::jsonb),
    nullif(r->>'score', '')::numeric,
    (r->>'position')::integer
  from jsonb_array_elements(p_rows) as r;
  return adding;
end;
$$;

revoke all on function public.match_begin_run(jsonb, integer) from public, anon, authenticated;
revoke all on function public.match_add_results(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.match_begin_run(jsonb, integer) to service_role;
grant execute on function public.match_add_results(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Fund-of-funds exceptions: a fund of funds with evidence that it invests
-- directly in operating companies. Only an approved exception lets it into
-- the tiers. The provider's classification is never changed.
create table if not exists public.match_fof_exceptions (
  firm_id text primary key,
  firm_name text not null,
  evidence_url text not null default '',
  evidence_note text not null,
  rationale text not null,
  status text not null default 'needs_review' check (status in ('needs_review', 'approved', 'rejected')),
  proposed_by text,
  proposed_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz,
  updated_by text,
  updated_at timestamptz not null default now(),
  check (length(trim(evidence_note)) >= 10),
  check (length(trim(rationale)) >= 20)
);

alter table public.match_fof_exceptions enable row level security;

-- Every change, with the row before and after and who made it.
create table if not exists public.match_fof_changes (
  id bigserial primary key,
  firm_id text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  before jsonb,
  after jsonb,
  actor text,
  at timestamptz not null default now()
);

create index if not exists match_fof_changes_firm on public.match_fof_changes (firm_id, id desc);
alter table public.match_fof_changes enable row level security;

create or replace function public.match_fof_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.match_fof_changes (firm_id, action, before, after, actor)
  values (
    coalesce(new.firm_id, old.firm_id),
    lower(tg_op),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    case when tg_op = 'DELETE' then old.updated_by else new.updated_by end
  );
  return null;
end;
$$;

revoke all on function public.match_fof_log() from public, anon, authenticated;

drop trigger if exists match_fof_exceptions_log on public.match_fof_exceptions;
create trigger match_fof_exceptions_log after insert or update or delete on public.match_fof_exceptions
  for each row execute function public.match_fof_log();

-- The change log itself is append-only.
drop trigger if exists match_fof_changes_no_change on public.match_fof_changes;
create trigger match_fof_changes_no_change before update or delete on public.match_fof_changes
  for each row execute function public.match_runs_immutable();
drop trigger if exists match_fof_changes_no_truncate on public.match_fof_changes;
create trigger match_fof_changes_no_truncate before truncate on public.match_fof_changes
  for each statement execute function public.match_runs_immutable();
revoke update, delete, truncate on public.match_fof_changes from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- When the Match Sandbox was last reset: its page shows only runs since.
create table if not exists public.match_sandbox_resets (
  id bigserial primary key,
  client_id uuid not null,
  reset_by text,
  reset_at timestamptz not null default now()
);

create index if not exists match_sandbox_resets_client on public.match_sandbox_resets (client_id, reset_at desc);
alter table public.match_sandbox_resets enable row level security;
