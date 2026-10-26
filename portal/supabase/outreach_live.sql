-- Going live: the client's inbox, the first monthly invoice, Go Live, the
-- Instantly campaign, delivery events and reply triage.
-- See lib/outreach/live.ts.
-- Run once in the Supabase SQL editor before deploying. Safe to re-run.
-- Needs outreach_campaign.sql.

alter table public.outreach_campaigns
  add column if not exists settings jsonb not null default '{}'::jsonb,
  add column if not exists inbox_email text,
  add column if not exists inbox_account_id text,
  add column if not exists inbox_connected_at timestamptz,
  add column if not exists inbox_status integer,
  add column if not exists inbox_checked_at timestamptz,
  add column if not exists oauth_session_id text,
  add column if not exists oauth_expires_at timestamptz,
  add column if not exists invoice_url text,
  add column if not exists invoice_paid_at timestamptz,
  add column if not exists invoice_marked_by text,
  add column if not exists instantly_campaign_id text,
  add column if not exists instantly_webhook_id text,
  add column if not exists consent_text text,
  add column if not exists live_at timestamptz,
  add column if not exists live_by text,
  add column if not exists wave2_pushed_at timestamptz,
  add column if not exists paused_at timestamptz,
  add column if not exists test_campaign_id text,
  add column if not exists test_sent_at timestamptz;

create index if not exists outreach_campaigns_instantly
  on public.outreach_campaigns (instantly_campaign_id);
create index if not exists outreach_campaigns_test
  on public.outreach_campaigns (test_campaign_id);

alter table public.outreach_messages
  add column if not exists instantly_lead_id text,
  add column if not exists pushed_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists last_step integer,
  add column if not exists opened_at timestamptz,
  add column if not exists replied_at timestamptz,
  add column if not exists bounced_at timestamptz,
  add column if not exists unsubscribed_at timestamptz,
  add column if not exists meeting_at timestamptz;

-- Every Instantly webhook delivery, as received.
create table if not exists public.outreach_events (
  id bigserial primary key,
  client_id uuid references public.clients(id) on delete cascade,
  instantly_campaign_id text,
  event_type text not null,
  lead_email text,
  step integer,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists outreach_events_client
  on public.outreach_events (client_id, received_at desc);
alter table public.outreach_events enable row level security;

-- Investor replies. Rupert sees all of them; the client sees only those he releases.
create table if not exists public.outreach_replies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  message_id uuid references public.outreach_messages(id) on delete set null,
  firm_id text not null default '',
  fund_name text not null default '',
  person_name text not null default '',
  lead_email text not null default '',
  subject text not null default '',
  body text not null default '',
  auto_reply boolean not null default false,
  received_at timestamptz not null default now(),
  instantly_email_id text,
  unibox_url text,
  label text,
  summary text not null default '',
  labelled_at timestamptz,
  visibility text not null default 'pending'
    check (visibility in ('pending', 'released', 'withheld')),
  withheld_reason text not null default '',
  decided_by text,
  decided_at timestamptz,
  client_read_at timestamptz
);

create unique index if not exists outreach_replies_email_id
  on public.outreach_replies (instantly_email_id) where instantly_email_id is not null;
create index if not exists outreach_replies_client
  on public.outreach_replies (client_id, received_at desc);
create index if not exists outreach_replies_pending
  on public.outreach_replies (visibility, received_at desc);

-- No policies on purpose: only the service role (server code) reads or writes.
alter table public.outreach_replies enable row level security;

-- The "Reply triage" prompt (agent_prompt:reply_triage), version 1. Skipped when it already has versions.
do $seed$
begin
  if not exists (select 1 from public.form_template_versions where slug = 'agent_prompt:reply_triage') then
    perform public.prompt_save_version(
      'agent_prompt:reply_triage',
      $rupert_prompt$AI prompt: Reply triage$rupert_prompt$,
      $rupert_prompt$You sort investor replies for Rupert, who runs a founder's investor outreach. Every reply comes to Rupert first; he decides what the founder sees. You label it and summarise it so he can decide fast.

Labels:
- interested: wants to talk, asks for a call, the deck, or a meeting.
- question: asks something before deciding (traction, round terms, team).
- not_now: not the right time, check back later, too early.
- pass: declines.
- out_of_office: an automatic away message.
- wrong_person: they left the fund, or point to someone else.
- bounce: a delivery failure message.
- opt_out: asks not to be contacted again.
- other: anything else.

Write a summary of one short sentence: what they said and anything Rupert must act on (a name they referred to, a date, a question). Quote nothing longer than a few words. Never invent anything that is not in the reply.$rupert_prompt$,
      'Starting version.',
      'migration');
  end if;
end;
$seed$;
