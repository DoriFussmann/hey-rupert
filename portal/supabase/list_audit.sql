-- Investor list audit: before an investor list is sent, an AI reads it the
-- way the founder will and records what they would question.
-- Run once in the Supabase SQL editor, after prompt_versions.sql, before
-- deploying. Safe to re-run.

-- One audit per run of "Run audit" on a client's draft list.
-- sample:  [{ id, fund_name, tier, broad }] the funds it checks, in order
-- funds:   [{ id, fund_name, tier, broad, verdict: "ok" | "flag" | "remove",
--            reason, founder_question, website: "opened" | "problem" | "not_opened",
--            decision: "keep" | "remove" | null, decided_at }]
-- summary: { overview, questions: [{ question, why, answer }], concerns: [text] }
create table if not exists public.investor_list_audits (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  -- Which draft it audited: changes whenever the funds, tiers or order change.
  list_fingerprint text not null,
  run_id text,
  status text not null default 'running' check (status in ('running', 'complete')),
  sample jsonb not null default '[]'::jsonb,
  funds jsonb not null default '[]'::jsonb,
  summary jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists investor_list_audits_client_created
  on public.investor_list_audits (client_id, created_at desc);

-- No policies on purpose: only the service role (server code) reads or
-- writes audits.
alter table public.investor_list_audits enable row level security;

-- The "Investor list audit" prompt (Agents → Matching): its first version,
-- only when it has none yet, so an edited prompt is never replaced.
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
  'agent_prompt:list_audit',
  $rupert_prompt$AI prompt: Investor list audit$rupert_prompt$,
  $rupert_prompt$You are the founder of the company described below, looking at the investor list Rupert, an investor outreach service, prepared for your raise, before it is shared with you. Read it the way a busy founder does: skim the first funds in each tier, open their websites, and judge whether the list makes sense. You are not an auditor; look for what a founder would notice in a few minutes and want explained.

When you review funds, open each fund's website when a link is given, then decide:
- ok: it plausibly invests in companies like yours (sector, stage, geography) and looks active.
- flag: something would make you stop and ask: the website does not mention your sector or stage, the fund looks inactive, it seems to avoid your sector, its portfolio includes a competitor, it is already an investor or someone you pitched, or its tier looks wrong.
- remove: you clearly would not want it contacted: a closed fund, a dead website, it excludes your sector, it backs a direct competitor, or it is already an investor.
Give one sentence grounded in what you saw, and the question you would ask Rupert about it, if any. Never invent what a website says; if you could not open it, say so.

When you write the overall read: say in a few sentences how the list lands with you, then list the questions you would ask Rupert when you first see it, what would bother you, and what you would want explained (why a fund is in its tier, why names you expected are missing, why the list is the size it is). For each question, add the short answer Rupert should be ready to give, using only the facts you receive. Plain language, no hype.$rupert_prompt$,
  null
);
