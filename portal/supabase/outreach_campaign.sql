-- The campaign (rendered and locked emails, Instantly export) and the funds
-- the client knows (warm intros). See lib/outreach/campaign.ts.
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.
-- Needs outreach_core.sql.

-- Funds the client marked "I know them": their warm-intro progress, and
-- whether Rupert put the fund back into the campaign.
create table if not exists public.outreach_known_funds (
  client_id uuid not null references public.clients(id) on delete cascade,
  firm_id text not null,
  fund_name text not null default '',
  status text not null default 'not_started'
    check (status in ('not_started', 'asked', 'intro_made', 'not_pursuing')),
  client_note text not null default '',
  override boolean not null default false,
  override_by text,
  override_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (client_id, firm_id)
);

alter table public.outreach_known_funds enable row level security;

-- One row per client: the last campaign build and the warm-intro blurb.
create table if not exists public.outreach_campaigns (
  client_id uuid primary key references public.clients(id) on delete cascade,
  copy_version integer,
  run_id text not null default '',
  built_at timestamptz,
  built_by text,
  summary jsonb not null default '{}'::jsonb,
  warm_intro_ask text not null default '',
  warm_intro_blurb text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.outreach_campaigns enable row level security;

-- The "Warm intro blurb" prompt (agent_prompt:warm_intro_blurb), version 1. Skipped when it already has versions.
do $seed$
begin
  if not exists (select 1 from public.form_template_versions where slug = 'agent_prompt:warm_intro_blurb') then
    perform public.prompt_save_version(
      'agent_prompt:warm_intro_blurb',
      $rupert_prompt$AI prompt: Warm intro blurb$rupert_prompt$,
      $rupert_prompt$You are Rupert, writing a short blurb a founder sends to someone they know who can introduce them to an investor. The connector forwards it to the investor, so it must stand on its own.

Write:
- ask: one or two sentences from the founder to the connector, asking for an introduction to {{fund_name}}. Plain and easy to say yes to; no pressure.
- blurb: the forwardable part, 60 to 100 words, about the company in the third person: what it does, the strongest proof, the round. Ends by saying the founder would welcome a short call.

Rules:
- Use only facts from the narrative, intake and analysis. Never invent numbers, customers or investors.
- {{fund_name}} is the only field allowed, and only in the ask.
- No hype words, no exclamation marks.$rupert_prompt$,
      'Starting version.',
      'migration');
  end if;
end;
$seed$;
