-- Prospects: founders who booked a call on Cal.com (the website's booking
-- page or the portal link), before they are clients. Run once in the Supabase
-- SQL editor before deploying. Safe to re-run. Needs prompt_versions.sql.
--
-- prospects       one row per person (by email). Holds the prep brief, the
--                 Dry Match estimate, the call outcome and the follow-up email.
--                 client_id is set once the prospect becomes a client.
-- prospect_calls  one row per Cal.com booking (a reschedule is a new booking;
--                 the old row is marked rescheduled). Holds the Resend ids of
--                 the scheduled prep email and the after-call check-in.
-- cal_webhook_events  every verified delivery from Cal.com, for debugging.
--
-- No policies on purpose: only the service role (server code) reads or writes.

create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text,
  company_name text,
  website text,
  -- Their answer to "How did you hear about us?" on the booking form.
  heard_from text,
  utm jsonb,
  status text not null default 'call_booked'
    check (status in ('call_booked', 'call_done', 'follow_up', 'not_a_fit', 'no_show', 'cancelled', 'converted')),
  brief jsonb,
  brief_status text not null default 'pending' check (brief_status in ('pending', 'running', 'ready', 'failed')),
  brief_error text,
  brief_at timestamptz,
  match jsonb,
  match_at timestamptz,
  outcome_notes text,
  outcome_at timestamptz,
  outcome_by text,
  follow_up jsonb,
  follow_up_sent_at timestamptz,
  reminder_sent_at timestamptz,
  client_id uuid references public.clients(id) on delete set null,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists prospects_email_key on public.prospects (lower(email));
create index if not exists prospects_created on public.prospects (created_at desc);

create table if not exists public.prospect_calls (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  cal_uid text not null unique,
  cal_booking_id bigint,
  status text not null default 'ACCEPTED',
  last_event text,
  event_title text,
  start_time timestamptz,
  end_time timestamptz,
  location text,
  video_url text,
  guests text[] not null default '{}',
  notes text,
  -- Every booking-form answer, keyed by field name: { label, value }.
  responses jsonb,
  rescheduled_from_uid text,
  cancellation_reason text,
  booked_at timestamptz,
  prep_email_id text,
  prep_email_at timestamptz,
  prep_email_status text check (prep_email_status in ('scheduled', 'sent', 'failed', 'cancelled')),
  prep_email_error text,
  checkin_email_id text,
  checkin_email_at timestamptz,
  checkin_email_status text check (checkin_email_status in ('scheduled', 'sent', 'failed', 'cancelled')),
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists prospect_calls_prospect on public.prospect_calls (prospect_id, start_time desc);
create index if not exists prospect_calls_upcoming on public.prospect_calls (start_time) where status = 'ACCEPTED';

create table if not exists public.cal_webhook_events (
  id uuid primary key default gen_random_uuid(),
  trigger_event text,
  cal_uid text,
  outcome text,
  payload jsonb,
  received_at timestamptz not null default now()
);

create index if not exists cal_webhook_events_received on public.cal_webhook_events (received_at desc);

alter table public.prospects enable row level security;
alter table public.prospect_calls enable row level security;
alter table public.cal_webhook_events enable row level security;

-- The two prompts (Agents → Prospect brief / Prospect follow-up email), version 1.
do $seed$
begin
  if not exists (select 1 from public.form_template_versions where slug = 'agent_prompt:prospect_brief') then
    perform public.prompt_save_version(
      'agent_prompt:prospect_brief',
      $rupert_prompt$AI prompt: Prospect brief (before a call)$rupert_prompt$,
      $rupert_prompt$You prepare Rupert's team for a free intro call with a founder who booked it on the Hey Rupert website. Rupert is an investor outreach service: it matches founders to investors and runs the outreach for their raise.

You receive what the founder typed when booking (name, email, company, notes, how they heard about us) and the labels Rupert's matching uses for financing type, stage, geography and sector.

Research lightly with web search: the company's website and a few public sources on the company and the founder (news, funding announcements and databases, the founder's own pages). This is prep for a 30-minute call, not due diligence: a few searches, nothing deep. Don't use or cite LinkedIn.

Deliver:
- person: who the founder is in one or two sentences (role, background), and up to 3 notable facts.
- company: one line on what it does, what it sells and to whom, HQ country, founded year, website, and its funding history (each round with amount, date and investors, as found).
- raise: what they are raising now (stage and amount), from their notes or the sources.
- signals: up to 4 short facts an investor would care about (traction, customers, team, press).
- fit: the financing type, stage, geography and one or two sector groups for Rupert's matching, chosen only from the labels given.
- questions: 3 questions for the call, the ones that decide whether and how Rupert can help.
- watch_outs: up to 3 things to be careful about, e.g. debt rather than equity, a raise too early or too late for outreach, a market with few specialist investors, facts that conflict.
- sources: the links you used.

Use only what you find or what the founder wrote. When something isn't found, leave it empty rather than guess. Plain, short, factual.$rupert_prompt$,
      'Starting version.',
      'migration'
    );
  end if;
  if not exists (select 1 from public.form_template_versions where slug = 'agent_prompt:prospect_follow_up') then
    perform public.prompt_save_version(
      'agent_prompt:prospect_follow_up',
      $rupert_prompt$AI prompt: Prospect follow-up email$rupert_prompt$,
      $rupert_prompt$You are Dori from Hey Rupert, writing the follow-up email to a founder after a free intro call. Rupert is an investor outreach service: it matches founders to investors and runs the outreach for their raise.

You receive Dori's notes from the call, the outcome, the prep brief on the company, and Rupert's first estimate of how many funds in its database fit the company, with the filters behind it and a few example funds.

Write:
- subject: under 60 characters, specific to their company.
- body: plain text, 80 to 150 words. Start with "Hi" and their first name, and end with "Dori". Thank them for the call in one line. Recap what was discussed and agreed in two or three lines, from the notes only. For a fit or a follow-up, give the next step from the notes, and you may share the estimate in one sentence, e.g. that a first pass of Rupert's database finds about N funds investing in their stage, market and region. Name example funds only when the notes say to. For not a fit, be kind and clear, and leave the estimate out.

Use only the facts you receive. Never promise meetings, replies or results. Plain, warm, human. No hype, no exclamation marks, no markdown.$rupert_prompt$,
      'Starting version.',
      'migration'
    );
  end if;
end
$seed$;
