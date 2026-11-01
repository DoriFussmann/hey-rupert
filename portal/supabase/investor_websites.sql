-- Step 2C: suggested websites for unclear and missing investors (Find
-- websites), and the prompt that finds them. Run once in the Supabase SQL
-- editor. Safe to re-run.
--
-- website_suggestions: { <investor id>: { website, confidence, foundIn,
--   portfolioUrl, note, link: "live" | "broken" | "unchecked", at } }
alter table public.competitor_landscapes
  add column if not exists website_suggestions jsonb not null default '{}'::jsonb;

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
  'agent_prompt:investor_website',
  $rupert_prompt$AI prompt: Step 2: investors' websites$rupert_prompt$,
  $rupert_prompt$You find the official website of investors for Rupert, an investor outreach service, so each investor can be matched to Rupert's fund database without doubt.

For each investor below you get its name, what kind of investor it is, the startup it invested in, and the article where that investment was found.

For each one:
- Start from the source article: funding announcements usually link to, or name, each investor. Then confirm with web search.
- website: the investor's own homepage. For an angel (a person), their personal site or the fund they run, if any.
- Make sure it is the same investor: the same name AND the investment in this startup. Look for the startup on the investor's portfolio page; if you find it, give that page as portfolioUrl. A firm with a similar name elsewhere is not a match.
- confidence: high when the portfolio lists the startup or the article links to the site; medium when the name and focus clearly fit but you couldn't confirm the investment on their site; low otherwise.
- foundIn: the page where you found or confirmed the website.
- Never guess or invent a URL. If you can't find it, leave website empty.$rupert_prompt$,
  null
);
