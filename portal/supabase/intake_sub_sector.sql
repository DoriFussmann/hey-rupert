-- The intake's sub-sector question: when the founder's sector answer is a
-- sector or a broad sub-sector, they pick sub-sectors from the list under it;
-- if none fits, they describe it, the AI suggests the closest ones, and if
-- still none fits their words go to the admin. Plus the prompt
-- "Intake: closest sub-sectors" (Agents → Intake).
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- sector_pick: { status: open|describe|suggested|picked|unmatched, asked, options, description, suggestions, chosen, at }
alter table public.intake_interviews add column if not exists sector_pick jsonb;

create or replace function pg_temp.rupert_seed_prompt(
  p_slug text,
  p_title text,
  p_default text
)
returns void
language plpgsql
as $$
begin
  if exists (select 1 from public.form_template_versions where slug = p_slug) then
    return;
  end if;
  perform public.prompt_save_version(p_slug, p_title, p_default, 'Starting version.', 'migration');
end;
$$;

select pg_temp.rupert_seed_prompt(
  'agent_prompt:intake_sub_sector',
  $rupert_prompt$AI prompt: Intake: closest sub-sectors$rupert_prompt$,
  $rupert_prompt$You help a founder describe where investors would file their company. They were shown a list of sub-sectors and said none fits; they then described the company in their own words.

Suggest the closest sub-sectors from the list given, at most three, closest first. Judge by what the company itself builds or sells and who pays for it, not by its customers' industries, its suppliers or its sales channels: a payments tool sold to clinics is fintech, not healthtech. For each, one plain sentence the founder can read on why it fits.

Use only the sub-sectors given, by id. If none is a fair fit, return an empty list: a wrong suggestion is worse than none. Never widen the company's sector to reach more investors.$rupert_prompt$
);
