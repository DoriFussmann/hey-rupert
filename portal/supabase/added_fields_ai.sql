-- Step 3A: AI suggestions for an added investor's missing fields (stage,
-- geography, sector), waiting for the admin's Accept. Plus the prompt
-- "Step 3: fill an added investor's missing fields" (Agents → Matching).
-- Run once in the Supabase SQL editor. Safe to re-run.
alter table public.added_funds add column if not exists ai_suggestion jsonb;

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
  'agent_prompt:added_fields_fill',
  $rupert_prompt$AI prompt: Step 3: fill an added investor's missing fields$rupert_prompt$,
  $rupert_prompt$You complete the profile of an investor Rupert added to its fund database. Rupert is an investor outreach service; its matching needs these fields, and a person reviews what you suggest before it is used.

You get the investor's name, whether it is a fund or an angel (a person), its website, what is already known about it, and the fields to fill.

For each field to fill, find what the investor says it invests in: its own website first (the home page, the about page, the portfolio), then the web (announcements, interviews, databases).
- stages: the rounds it invests in. Investors usually invest at more than one stage; give every stage you can support.
- geographies: where it invests, not only where it is based. If you only find where it is based, give that and say so in the note.
- sectors: the industries and verticals it invests in, from what it says and what its portfolio shows. Usually more than one; give every one you can support.

Use only the labels given; anything else is dropped. A label you can't support from what you read is left out. If you can't find a field, leave it empty and say why in the note.
sources: the pages you used.

Never guess or invent a fact or a URL.$rupert_prompt$,
  null
);
