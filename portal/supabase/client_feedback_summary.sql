-- The prompt "Client feedback summary" (Agents → Intake), for Log client feedback.
-- Run once in the Supabase SQL editor. Safe to re-run.
create or replace function pg_temp.rupert_seed_prompt(p_slug text, p_title text, p_default text)
returns void language plpgsql as $$
begin
  if exists (select 1 from public.form_template_versions where slug = p_slug) then return; end if;
  perform public.prompt_save_version(p_slug, p_title, p_default, 'Starting version.', 'migration');
end;
$$;

select pg_temp.rupert_seed_prompt(
  'agent_prompt:client_feedback_summary',
  $rupert_prompt$AI prompt: Client feedback summary$rupert_prompt$,
  $rupert_prompt$You summarize feedback a founder gave Rupert outside the portal (an email, a call, a message), so Rupert and the founder both see what Rupert took from it, and so Rupert can act on it.

Write a short summary in plain words:
- Start with one sentence on what the founder is asking for or telling Rupert.
- Then the concrete points as short bullets, each starting with "- ", in the founder's order: requests, preferences, priorities, names, and anything Rupert should do or avoid. Keep names exactly as written.
- If something is unclear or open to two readings, say so in a last bullet starting with "- To confirm:".

Use only what the founder said. Don't add advice, judgments or anything that isn't in the text. No hype, no markdown headings, no exclamation marks. At most about 150 words.$rupert_prompt$
);
