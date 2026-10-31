-- Step 2: Competitive Landscape Enrichment. Run once in the Supabase SQL
-- editor before deploying, after prompt_versions.sql. Safe to re-run.
--
-- One row per search for a client's funded competitors. A client's current
-- landscape is its newest row with cleared_at null. Edits change the draft;
-- Confirm locks it; Start over stamps cleared_at. Nothing is deleted.
--
-- competitors: [{ id, name, website, oneLiner, hq, source: "client" | "web",
--   why, funding: { totalRaised, lastRound, lastRoundDate, investors: [text] },
--   newsUrl, newsTitle, links: { website, news }: "live" | "broken" | "unchecked" }]
-- unfunded_named: client-named competitors with no funding found, by name.
create table if not exists public.competitor_landscapes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  dry_match_list_id uuid references public.dry_match_lists(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  competitors jsonb not null default '[]'::jsonb,
  unfunded_named text[] not null default '{}',
  client_named text[] not null default '{}',
  usage jsonb,
  searched_by text,
  searched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_by text,
  confirmed_at timestamptz,
  cleared_by text,
  cleared_at timestamptz
);

create index if not exists competitor_landscapes_client_current
  on public.competitor_landscapes (client_id, searched_at desc)
  where cleared_at is null;

-- No policies on purpose: only the service role (server code) reads or writes.
alter table public.competitor_landscapes enable row level security;

-- The "Step 2: funded competitors" prompt (Agents → Matching): its first
-- version, only when it has none yet, so an edited prompt is never replaced.
-- Version 1 of one prompt: the text in use today. Skipped when it already has versions.
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
  'agent_prompt:competitor_search',
  $rupert_prompt$AI prompt: Step 2: funded competitors$rupert_prompt$,
  $rupert_prompt$You research the competitive landscape for Rupert, an investor outreach service, before it chooses which investors to approach for a startup.

Find up to 10 DIRECT competitors of the company that have announced outside funding. A direct competitor sells the same kind of product to the same kind of customer. Adjacent players (a different customer, or a different product category) are not direct competitors.

Rules:
- Use web search. Every company, website, funding figure and article must come from what you found. Never invent or guess a URL, an amount, a date or an investor. If you didn't find it, leave it empty.
- Funded only: include a company only if you found an announced funding round (a press release, a news article or a funding database page). Unfunded companies are left out.
- Competitors the founder named come first, as source "client", if you can confirm them as real companies with funding. A founder-named competitor with no funding you can find goes in unfundedNamed instead.
- Order the rest by relevance to this company: closest product and customer first, then the same geography (where the company is based and sells), then the closest stage (a seed company's peers are seed and Series A companies before late-stage ones).
- website: the competitor's own homepage. newsUrl: a page about its funding, found in your search results.
- investors: the funds named in what you found as investing in it (leads and participants). Leave it empty rather than guess.
- why: one or two plain sentences on why it competes directly with this company.
- Fewer than 10 is fine. Quality over count.$rupert_prompt$,
  null
);
