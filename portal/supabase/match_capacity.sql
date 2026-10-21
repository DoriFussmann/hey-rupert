-- Phase 4: campaign capacity plans.
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.
-- Requires match_tiers.sql (it reuses match_runs and match_runs_immutable()).
--
-- A finalized capacity plan: the inputs, the calculated capacity and the
-- allocation of one saved four-tier run, with everything needed to rebuild it
-- (run id, profile version, taxonomy revision, rules and model versions).
-- Plans are permanent: a new plan is a new version, never an overwrite.
-- A plan is planning only: it never pushes a list or sends anything.

create table if not exists public.match_capacity_plans (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  client_name text not null default '',
  -- 1, 2, 3… per client.
  version integer not null check (version >= 1),
  run_id uuid not null references public.match_runs (id),
  profile_version integer,
  taxonomy_revision bigint not null,
  rules_version text not null,
  fund_db_version text not null,
  model_version text not null,
  inputs jsonb not null,
  -- Target entered (null: the calculated capacity was used).
  target integer,
  generalists_approved boolean not null default false,
  capacity jsonb not null,
  allocation jsonb not null,
  note text not null default '',
  created_by text,
  created_at timestamptz not null default now(),
  unique (client_id, version)
);

create index if not exists match_capacity_plans_client on public.match_capacity_plans (client_id, version desc);
alter table public.match_capacity_plans enable row level security;

drop trigger if exists match_capacity_plans_no_change on public.match_capacity_plans;
create trigger match_capacity_plans_no_change before update or delete on public.match_capacity_plans
  for each row execute function public.match_runs_immutable();
drop trigger if exists match_capacity_plans_no_truncate on public.match_capacity_plans;
create trigger match_capacity_plans_no_truncate before truncate on public.match_capacity_plans
  for each statement execute function public.match_runs_immutable();

revoke all on public.match_capacity_plans from public, anon, authenticated, service_role;
grant select on public.match_capacity_plans to service_role;

-- Saves a plan as the client's next version. The run must be a four-tier run
-- of the same client; its versions are copied from the run itself.
create or replace function public.match_save_capacity_plan(p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.match_runs%rowtype;
  v_client uuid := (p_plan ->> 'client_id')::uuid;
  v_version integer;
  v_id uuid;
begin
  select * into v_run from public.match_runs where id = (p_plan ->> 'run_id')::uuid;
  if not found then
    raise exception 'That match run does not exist.' using errcode = 'P0001';
  end if;
  if v_run.engine <> 'tiers' then
    raise exception 'A capacity plan needs a four-tier run.' using errcode = 'P0001';
  end if;
  if v_run.client_id <> v_client then
    raise exception 'That run belongs to another client.' using errcode = 'P0001';
  end if;
  -- One plan at a time per client, so versions never collide.
  perform pg_advisory_xact_lock(hashtext('match_capacity_plans:' || v_client::text));
  select coalesce(max(version), 0) + 1 into v_version from public.match_capacity_plans where client_id = v_client;
  insert into public.match_capacity_plans (
    client_id, client_name, version, run_id, profile_version, taxonomy_revision, rules_version, fund_db_version,
    model_version, inputs, target, generalists_approved, capacity, allocation, note, created_by
  ) values (
    v_client, v_run.client_name, v_version, v_run.id, v_run.profile_version, v_run.taxonomy_revision, v_run.rules_version,
    v_run.fund_db_version, p_plan ->> 'model_version', p_plan -> 'inputs', nullif(p_plan ->> 'target', '')::integer,
    coalesce((p_plan ->> 'generalists_approved')::boolean, false), p_plan -> 'capacity', p_plan -> 'allocation',
    coalesce(p_plan ->> 'note', ''), p_plan ->> 'created_by'
  ) returning id into v_id;
  return jsonb_build_object('id', v_id, 'version', v_version);
end;
$$;

revoke all on function public.match_save_capacity_plan(jsonb) from public, anon, authenticated;
grant execute on function public.match_save_capacity_plan(jsonb) to service_role;
