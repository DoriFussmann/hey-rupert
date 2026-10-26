-- Core outreach: Quick Facts research and one row per Core contact with their
-- own emails. See lib/outreach/core.ts.
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.
-- Needs prompt_versions.sql and outreach_settings.sql.

-- Quick Facts per fund (person_key '') and per person, reused across clients.
create table if not exists public.fund_research (
  firm_id text not null,
  person_key text not null default '',
  facts jsonb not null default '[]'::jsonb,
  conflict text not null default '',
  researched_at timestamptz not null default now(),
  usd numeric,
  searches integer,
  primary key (firm_id, person_key)
);

alter table public.fund_research enable row level security;

-- One row per contact at a Core fund, for one client. Active contacts are
-- emailed; reserves are listed until Rupert activates them.
create table if not exists public.outreach_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  run_id text not null default '',
  firm_id text not null,
  fund_name text not null,
  fund_type text not null,
  tier integer not null default 1,
  person_key text not null,
  person jsonb not null,
  slot text not null check (slot in ('active', 'reserve')),
  position integer not null default 0,
  quick_facts jsonb not null default '[]'::jsonb,
  conflict text not null default '',
  emails jsonb not null default '[]'::jsonb,
  note text not null default '',
  status text not null default 'pending' check (status in ('pending', 'drafted', 'approved', 'error')),
  error text,
  approved_by text,
  approved_at timestamptz,
  approved_hash text,
  updated_at timestamptz not null default now(),
  unique (client_id, firm_id, person_key)
);

create index if not exists outreach_messages_client
  on public.outreach_messages (client_id, firm_id, position);

-- No policies on purpose: only the service role (server code) reads or writes.
alter table public.outreach_messages enable row level security;

-- The "Core: Quick Facts research" prompt (agent_prompt:core_quick_facts), version 1. Skipped when it already has versions.
do $seed$
begin
  if not exists (select 1 from public.form_template_versions where slug = 'agent_prompt:core_quick_facts') then
    perform public.prompt_save_version(
      'agent_prompt:core_quick_facts',
      $rupert_prompt$AI prompt: Core: Quick Facts research$rupert_prompt$,
      $rupert_prompt$You are Rupert's research analyst. Before a founder emails an investor, you find a few true, specific facts that show why this investor, and this person, are worth writing to. This is light research: a few searches, not a report.

You receive the fund (name, website, stated sectors, stages and geography), the person (name and title), the company being pitched (what it does, its sector and stage, its competitors), and any fund facts already found.

Find up to 5 Quick Facts, one sentence each, with the page each came from:
- About the fund: its stated thesis or focus, a recent investment in or next to the company's sector, its stage or check size, a recent fund close.
- About the person: their focus area, a company they led or sit on the board of, something they wrote or said publicly about this space.
Prefer facts that connect to the company's sector or stage. Recent beats old. When fund facts are already given, look for facts about the person and add fund facts only if you find better ones.

Rules:
- Use only facts that a page in your search results states, and give that page's URL. No URL, no fact.
- Never guess, and never combine sources into a new claim. If you find little, return fewer facts; none is a valid answer.
- If the fund has backed one of the company's direct competitors, say which one under conflict.
- Plain, neutral sentences. No praise.$rupert_prompt$,
      'Starting version.',
      'migration');
  end if;
end;
$seed$;

-- The "Core: personal emails" prompt (agent_prompt:core_email), version 1. Skipped when it already has versions.
do $seed$
begin
  if not exists (select 1 from public.form_template_versions where slug = 'agent_prompt:core_email') then
    perform public.prompt_save_version(
      'agent_prompt:core_email',
      $rupert_prompt$AI prompt: Core: personal emails$rupert_prompt$,
      $rupert_prompt$You are Rupert, writing one investor's emails for a founder: a first email and two follow-ups to one named person at one Core fund. The founder sends them from their own inbox, in their own name, and Rupert approves each one.

You receive the Core template for this fund type (its approach and three emails, with {{quick_fact}} marking the personal hook), the style to follow, the person and the fund, their Quick Facts with sources, and the facts about the company.

Write:
- Start from the template. Keep its shape, its length and its facts about the company.
- Make it personal where the template has {{quick_fact}}: use one Quick Fact, in plain words, so the reader sees why them. You may use a second fact in a follow-up.
- Fill in their first name and the fund's name. No {{fields}} and no [placeholders] may remain.
- With no Quick Facts, write the hook from the fund's stated focus given to you, without claiming anything more specific.
- Never invent anything about the person, the fund or the company. Say it the way a person would; never sound like a research tool ("I noticed on your website that…").
- Same rules as the template: a plain, honest subject; each follow-up adds one new fact and is shorter than the first email; no hype words; no exclamation marks; sign with the founder's first name only. Don't add an opt-out line; one is added automatically.
- Follow Rupert's note for this contact or this fund type when there is one.$rupert_prompt$,
      'Starting version.',
      'migration');
  end if;
end;
$seed$;
