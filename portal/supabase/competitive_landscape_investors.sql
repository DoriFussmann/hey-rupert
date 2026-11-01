-- Step 2B: investors in the confirmed competitors, and the primary sector of
-- each competitor. Run once in the Supabase SQL editor before deploying,
-- after competitive_landscape.sql. Safe to re-run.
--
-- investors: [{ id, name, website, kind, source, backed: [{ competitorId,
--   competitor, round, lead, sourceUrl }] }]
-- investor_research: { <competitor id>: { status: "done" | "failed", at, found, error } }
alter table public.competitor_landscapes
  add column if not exists investors jsonb not null default '[]'::jsonb,
  add column if not exists investor_research jsonb not null default '{}'::jsonb,
  add column if not exists investors_status text not null default 'none',
  add column if not exists investors_confirmed_at timestamptz,
  add column if not exists investors_confirmed_by text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'competitor_landscapes_investors_status_check') then
    alter table public.competitor_landscapes
      add constraint competitor_landscapes_investors_status_check
      check (investors_status in ('none', 'draft', 'confirmed'));
  end if;
end;
$$;

-- The two Step 2 prompts (Agents → Matching): their first versions, only
-- when they have none yet, so an edited prompt is never replaced.
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
  'agent_prompt:competitor_sector',
  $rupert_prompt$AI prompt: Step 2: competitors' primary sector$rupert_prompt$,
  $rupert_prompt$You classify startups for Rupert, an investor outreach service. For each competitor below, choose its primary sector: the one sector an investor would file it under, from the sector labels given. Base it on what the company sells and to whom, as described. Use only the labels given, spelled exactly. If none fits, leave it empty.$rupert_prompt$,
  null
);

select pg_temp.rupert_seed_prompt(
  'agent_prompt:competitor_investors',
  $rupert_prompt$AI prompt: Step 2: competitors' investors$rupert_prompt$,
  $rupert_prompt$You research who has invested in a startup, for Rupert, an investor outreach service. Rupert uses the result to find investors who back companies like its client.

Find every investor in the competitor named below, across all its funding rounds: venture funds, angels, corporate investors and accelerators.

Rules:
- Use web search: press releases, news articles, the company's own announcements, and funding database pages. Every investor must come from a page you found; give that page as sourceUrl. Never guess or invent an investor, a round or a URL.
- Investors already named are a starting point: include each one you can confirm, with its source.
- round: the round they joined, as reported (for example "Seed", "$25M Series A"). lead: true only if a source says they led it.
- website: the investor's own homepage, only if you found it.
- kind: fund, angel (a person), corporate, accelerator or other.
- No limit on how many. Include everyone you can confirm, and no one you can't.$rupert_prompt$,
  null
);
