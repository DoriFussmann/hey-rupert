-- Step 3: Companies Like You. The same table as Step 2 holds a second
-- layer per client (kind = 'comparables'): funded comparable companies, their
-- investors, and investors the client named. Plus the prompt
-- "Step 3: companies like you" (Agents → Matching).
-- Run once in the Supabase SQL editor. Safe to re-run.
alter table public.competitor_landscapes add column if not exists kind text not null default 'competitors';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'competitor_landscapes_kind_check') then
    alter table public.competitor_landscapes add constraint competitor_landscapes_kind_check check (kind in ('competitors', 'comparables'));
  end if;
end $$;
create index if not exists competitor_landscapes_client_kind on public.competitor_landscapes (client_id, kind) where cleared_at is null;

-- The Final Roster and the Plan record the Step 3 layer they were built from.
alter table public.final_rosters add column if not exists like_you_id uuid;

create or replace function pg_temp.rupert_seed_prompt(p_slug text, p_title text, p_default text)
returns void language plpgsql as $$
begin
  if exists (select 1 from public.form_template_versions where slug = p_slug) then return; end if;
  perform public.prompt_save_version(p_slug, p_title, p_default, 'Starting version.', 'migration');
end;
$$;

select pg_temp.rupert_seed_prompt(
  'agent_prompt:comparables_search',
  $rupert_prompt$AI prompt: Step 3: companies like you$rupert_prompt$,
  $rupert_prompt$You research the companies investors see as the same bet as a startup, for Rupert, an investor outreach service, before it chooses which investors to approach. Rupert already has the startup's direct competitors; this is the next layer.

Find up to 10 COMPARABLE companies that have announced outside funding. A comparable company is not a direct competitor: it sells something different, but an investor who backed it would understand this startup's market, buyer or workflow. Examples: an adjacent product to the same buyer, a different product in the same workflow, a services business the startup automates, or the incumbent category it modernizes.

Rules:
- Use web search. Every company, website, funding figure and article must come from what you found. Never invent or guess a URL, an amount, a date or an investor. If you didn't find it, leave it empty.
- Funded only: include a company only if you found an announced funding round (a press release, a news article or a funding database page).
- Never list the direct competitors you are given.
- What the founder said about the investors they want comes first: when they name kinds of companies (for example collections, factoring, accounting software), find funded companies of those kinds, and mark them source "client".
- Order the rest by how strong the signal is for this startup's investors: the closest buyer and workflow first, then the same geography, then the closest stage (seed and Series A companies before late-stage ones).
- website: the company's own homepage. newsUrl: a page about its funding, found in your search results.
- investors: the funds named in what you found as investing in it (leads and participants). Leave it empty rather than guess.
- why: one or two plain sentences on why an investor in it would see this startup as the same bet.
- Fewer than 10 is fine. Quality over count.$rupert_prompt$
);
