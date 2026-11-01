-- Funds added by Rupert (Matching → Step 2 → Try and Add to DB). Run once
-- in the Supabase SQL editor. Safe to re-run.
--
-- A pending fund is used only for the client it was found for. Once an
-- admin approves it (Fund Database page → Added by Rupert), it joins the
-- shared Fund Database for every client, under its own id ("RUP-…"), apart
-- from the provider's FirmIDs. Rejected funds stay on record.
--
-- Research values are taxonomy labels; contacts come from Hunter.
-- contacts: [{ first, last, title, email, confidence, linkedin, source }]
-- sources:  [{ url, label }]
create table if not exists public.added_funds (
  id uuid primary key default gen_random_uuid(),
  firm_id text not null unique,
  name text not null,
  kind text not null default 'fund' check (kind in ('fund', 'angel')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  website text not null default '',
  description text not null default '',
  hq_city text not null default '',
  hq_country text not null default '',
  founded_year integer,
  firm_type text not null default '',
  stages text[] not null default '{}',
  geographies text[] not null default '{}',
  industries text[] not null default '{}',
  verticals text[] not null default '{}',
  financing text[] not null default '{}',
  contacts jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  notes text not null default '',
  -- Where it was found.
  found_for_client uuid references public.clients(id) on delete set null,
  landscape_id uuid references public.competitor_landscapes(id) on delete set null,
  investor_id text,
  hunter_credits numeric not null default 0,
  usage jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text not null default ''
);

create index if not exists added_funds_status on public.added_funds (status, created_at desc);
create index if not exists added_funds_landscape on public.added_funds (landscape_id);
-- One added fund per investor of a landscape.
create unique index if not exists added_funds_investor on public.added_funds (landscape_id, investor_id) where investor_id is not null;

-- No policies on purpose: only the service role (server code) reads or writes.
alter table public.added_funds enable row level security;

-- The "Step 2: research a fund to add" prompt (Agents → Matching).
create or replace function pg_temp.rupert_seed_prompt(
  p_slug text,
  p_title text,
  p_default text,
  p_add_to_edited text
)
returns void
language plpgsql
as $$
declare
  v_existing text;
begin
  if exists (select 1 from public.form_template_versions where slug = p_slug) then
    return;
  end if;
  select nullif(btrim(content), '') into v_existing from public.form_templates where slug = p_slug;
  if v_existing is null then
    perform public.prompt_save_version(p_slug, p_title, p_default,
      'Starting version.', 'migration');
  else
    perform public.prompt_save_version(
      p_slug,
      p_title,
      case when p_add_to_edited is null then v_existing else v_existing || E'\n\n' || p_add_to_edited end,
      case when p_add_to_edited is null
        then 'Starting version: your edited prompt in use before versioning.'
        else 'Starting version: your edited prompt in use before versioning, plus the closing and opening rules that were in the code.'
      end,
      'migration');
  end if;
end;
$$;

select pg_temp.rupert_seed_prompt(
  'agent_prompt:add_fund_research',
  $rupert_prompt$AI prompt: Step 2: research a fund to add$rupert_prompt$,
  $rupert_prompt$You research an investor that is missing from Rupert's fund database, so it can be added. Rupert is an investor outreach service; what you find is checked by a person before it is used for other clients.

You get the investor's name, whether it is a fund or an angel (a person), its website if known, the startup it invested in, and the article where that investment was found.

Find, from the investor's own website first and then the web:
- website (its homepage), a one-sentence description of what it invests in, HQ city and country, and the year it was founded.
- firmType, stages, geographies, industries, verticals and financing: what the investor says it invests in, using only the labels given. A label you can't support from what you read is left out. Fewer, well-supported labels are better than many.
- people: the investing team named on its website (partners, principals, associates), with their titles. Not operations or admin staff.
- For an angel: the person's first and last name, title and the firm they work at, if any, and that firm's website.
- sources: the pages you used.

Never guess or invent a URL, a person, a title or a fact. Leave a field empty if you didn't find it.$rupert_prompt$,
  null
);
