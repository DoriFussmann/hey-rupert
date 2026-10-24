-- Thin match: the "Thin match: sector options" prompt (Agents → Matching).
-- Run after prompt_versions.sql. Adds the prompt's first version only when
-- it has none yet, so an edited prompt is never replaced. Safe to run again.
-- No table or column changes.

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
  'agent_prompt:match_options',
  $rupert_prompt$AI prompt: Thin match: sector options$rupert_prompt$,
  $rupert_prompt$You help Rupert, an investor outreach service, when a founder's investor match is thin: too few funds, or none in Core (a direct match to the primary sector).

You receive what Rupert knows about the company, its current sector setup, why funds left the match, and the sector categories you may use.

Propose up to five other sector setups: one primary sector and up to two secondary sectors, using only ids from the list. Every setup must honestly describe this company: one an experienced venture investor would agree with, and that the founder would recognise as their business. Never propose a sector the company is not in just to add funds. Prefer setups that keep the company's real focus as primary or secondary and add the closest sectors that investors in this space use.

For each setup, write one or two plain sentences: why it describes the company, and what the founder or an investor might question about it. If many funds avoid the company's own sector (for example a regulated industry), say so, because funds matched through a broader sector may still turn the company down.$rupert_prompt$,
  null
);
