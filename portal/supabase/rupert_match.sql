-- Rupert Match: fund database versions, client match profiles, reviews,
-- funds hidden for all clients, website checks, and the intake topics
-- matching needs.
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Private storage for uploaded workbooks and normalized snapshots. Only the
-- server (service role) reads or writes it, so no storage policies.
insert into storage.buckets (id, name, public, file_size_limit)
values ('fund-database', 'fund-database', false, 52428800)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit;

-- ---------------------------------------------------------------------------
-- Fund database versions: one is live; staged ones wait for "Apply";
-- archived ones can be made live again.
create table if not exists public.fund_db_versions (
  id uuid primary key,
  file_name text not null,
  upload_path text not null,
  snapshot_path text not null,
  status text not null default 'staged'
    check (status in ('staged', 'live', 'archived')),
  firms integer not null default 0,
  contacts integer not null default 0,
  offices integer not null default 0,
  -- Changes against the version that was live at upload time.
  diff jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create unique index if not exists fund_db_versions_one_live
  on public.fund_db_versions ((true))
  where status = 'live';

alter table public.fund_db_versions enable row level security;

-- Makes a version live in one step (the previous live one is archived).
create or replace function public.apply_fund_db_version(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.fund_db_versions
    where id = p_id and status in ('staged', 'archived')
  ) then
    raise exception 'Fund database version % is not available to apply', p_id;
  end if;
  update public.fund_db_versions set status = 'archived' where status = 'live';
  update public.fund_db_versions
    set status = 'live', applied_at = now()
    where id = p_id;
end;
$$;

revoke all on function public.apply_fund_db_version(uuid) from public, anon, authenticated;
grant execute on function public.apply_fund_db_version(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Per-client match profile: intake answers + operator settings.
create table if not exists public.match_profiles (
  client_id uuid primary key references public.clients(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  status text not null default 'needs_info'
    check (status in ('ready', 'needs_info')),
  -- [{ id, label, kind: missing | unasked }]
  missing jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  -- Interview updated_at the profile was built from.
  source_interview_at timestamptz,
  built_at timestamptz,
  -- Set when the profile was edited by hand after it was built.
  edited_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.match_profiles enable row level security;

-- Approve / reject of a fund for one client. Keyed by FirmID, so reviews
-- survive database updates.
create table if not exists public.match_reviews (
  client_id uuid not null references public.clients(id) on delete cascade,
  firm_id text not null,
  firm_name text not null default '',
  status text not null check (status in ('ok', 'no')),
  reason text,
  note text,
  tier text,
  reviewed_by text,
  reviewed_at timestamptz not null default now(),
  primary key (client_id, firm_id)
);

alter table public.match_reviews enable row level security;

-- Funds hidden for every client.
create table if not exists public.match_suppressions (
  firm_id text primary key,
  firm_name text not null default '',
  reason text,
  from_client uuid references public.clients(id) on delete set null,
  created_by text,
  created_at timestamptz not null default now()
);

alter table public.match_suppressions enable row level security;

-- Latest website check per fund. `url` is the website that was checked; a
-- result for a different URL is ignored.
create table if not exists public.match_site_checks (
  firm_id text primary key,
  url text not null default '',
  result jsonb not null,
  checked_at timestamptz not null default now()
);

create index if not exists match_site_checks_checked_at
  on public.match_site_checks (checked_at);

alter table public.match_site_checks enable row level security;

-- ---------------------------------------------------------------------------
-- Intake topics: add what matching needs to a saved topic list. (Without a
-- saved list, the defaults in the code already include them.) Adds Sector,
-- Round terms, Markets & background and Competitors where missing, makes
-- Existing investors & exclusions required and asks about funds pitched in
-- the last 12 months. Everything stays editable in Forms → Intake.
do $$
declare
  current_topics jsonb;
  result jsonb;
begin
  select content::jsonb into current_topics
  from public.form_templates
  where slug = 'intake_topics';

  if current_topics is null or jsonb_typeof(current_topics) <> 'array' then
    return;
  end if;

  with els as (
    select e, ord::numeric as pos
    from jsonb_array_elements(current_topics) with ordinality as t(e, ord)
  ),
  patched as (
    select
      case
        when e->>'id' = 'existing_and_exclusions' then
          jsonb_set(
            jsonb_set(e, '{required}', 'true'::jsonb),
            '{guidance}',
            to_jsonb(
              case
                when coalesce(e->>'guidance', '') ilike '%12 months%' then e->>'guidance'
                else left(trim(coalesce(e->>'guidance', '') || ' Also: funds already pitched in the last 12 months, and how it went. "None" is a valid answer.'), 600)
              end
            )
          )
        when e->>'id' = 'company' and coalesce(e->>'guidance', '') not ilike '%state%' then
          jsonb_set(
            e,
            '{guidance}',
            to_jsonb(left(trim(coalesce(e->>'guidance', '') || ' For US companies, the state.'), 600))
          )
        else e
      end as e,
      pos
    from els
  ),
  additions as (
    select v.topic as e,
      coalesce(
        (select els.pos from els where els.e->>'id' = v.anchor limit 1) + v.offset_pos,
        1000 + v.n
      ) as pos
    from (values
      (1, 'company', 0.5::numeric, jsonb_build_object(
        'id', 'sector',
        'title', 'Sector',
        'guidance', 'Where investors would file the company: the core sector and up to two secondary ones, in order of importance. Suggest two or three plain labels from what the founder said (for example fintech, SaaS, healthtech) and ask which fits best. Also the business model (B2B, B2C, marketplace, hardware).',
        'required', true)),
      (2, 'raise', 0.5::numeric, jsonb_build_object(
        'id', 'round_terms',
        'title', 'Round terms',
        'guidance', 'The instrument (SAFE, convertible note, priced equity or debt), whether they still need a lead investor, and the valuation or cap if set.',
        'required', true)),
      (3, 'investor_preferences', 0.5::numeric, jsonb_build_object(
        'id', 'markets_background',
        'title', 'Markets & background',
        'guidance', 'Countries or regions they sell into, where the company is incorporated (for example a US Delaware C-corp), the founders'' backgrounds, and any previous rounds.',
        'required', false)),
      (4, 'existing_and_exclusions', 0.5::numeric, jsonb_build_object(
        'id', 'competitors',
        'title', 'Competitors',
        'guidance', 'Direct competitors investors would compare them to, so Rupert avoids funds backing a competitor. "None" is a valid answer.',
        'required', true))
    ) as v(n, anchor, offset_pos, topic)
    where not exists (select 1 from els where els.e->>'id' = v.topic->>'id')
  ),
  combined as (
    select e, pos from patched
    union all
    select e, pos from additions
  )
  select jsonb_agg(e order by pos) into result from combined;

  -- The app accepts at most 20 topics; never save a list it would reject.
  if jsonb_array_length(result) > 20 then
    raise notice 'Intake topics not updated: the list would exceed 20 topics. Add Sector, Round terms and Competitors in Forms → Intake.';
    return;
  end if;

  update public.form_templates
  set content = result::text, updated_at = now()
  where slug = 'intake_topics';
exception
  when invalid_text_representation then
    raise notice 'Intake topics not updated: the saved list is not valid JSON.';
end;
$$;
