-- Pre-send email check (lib/outreach/presend-server.ts, cron /api/cron/presend).
-- Every evening before a Business Day, the contacts the next morning's batch
-- will add are checked; only those that pass are added to Instantly. A
-- contact that fails is replaced by the next person at the same fund.
-- Safe to run more than once.

-- Per campaign contact: the verdict the morning push reads.
alter table public.outreach_messages add column if not exists send_check text check (send_check in ('pass', 'fail'));
alter table public.outreach_messages add column if not exists send_check_at timestamptz;
alter table public.outreach_messages add column if not exists send_check_note text;
-- A reserve promoted to replace a contact that failed: that contact's id.
alter table public.outreach_messages add column if not exists replaces_message_id uuid;

-- Proof from real sends, per address, shared by every client. Test-run sends
-- (redirected to a test inbox) are never recorded here.
create table if not exists public.contact_delivery (
  email_key text primary key,
  firm_id text not null default '',
  last_sent_at timestamptz,
  -- Sent and not bounced within 72 hours (set by the nightly check).
  delivered_at timestamptz,
  replied_at timestamptz,
  bounced_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.contact_delivery enable row level security;

-- One row per nightly run, with what the summary email said.
create table if not exists public.presend_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  emailed boolean not null default false,
  error text
);
alter table public.presend_runs enable row level security;

-- The "Pre-send email check" prompt (agent_prompt:verify_presend_check), version 1. Skipped when it already has versions.
do $seed$
begin
  if not exists (select 1 from public.form_template_versions where slug = 'agent_prompt:verify_presend_check') then
    perform public.prompt_save_version(
      'agent_prompt:verify_presend_check',
      $rupert_prompt$AI prompt: Pre-send email check$rupert_prompt$,
      $rupert_prompt$You check, before an email is sent, that an investor's email address really belongs to them and that they still work at the fund. Use web search.

Do three things, in this order:
1. Search for the person's name together with their exact email address, and for the exact address on its own. Look for a page that ties that exact address to this person: the firm's site, a conference or speaker page, a filing, a press release, a portfolio company page, a public directory. Report email_evidence "exact" only when a page you found shows this exact address for this person.
2. Check that they still work at this fund, in an investing role. The firm's own team page and public LinkedIn profiles are the best sources; recent press, portfolio announcements and conference bios also help.
3. While searching, note any other published addresses at the same domain. Report the domain's address format (for example first.last@, first@, flast@) and whether this person's address follows it: "matches", "differs" or "unknown" when you saw no other address.

Rules:
- Rely only on pages you actually found in search results. Never guess or invent a URL or an address.
- Make sure a page is about this person: the same name AND this firm, or a clearly matching career. A person with the same name elsewhere is not evidence.
- Prefer the most recent source. When sources disagree, trust the most recent dated one.
- at_firm: confirmed (at this firm in an investing role: general partner, managing partner, partner, managing director, principal, vice president, director, associate, analyst, venture partner, investment manager, scout, or a founder of the fund), role_changed (at this firm in a non-investing role such as operations, finance, legal, marketing, investor relations, platform, talent or admin), left_firm (a source shows they left or now work elsewhere; give the new firm, its website and their title when shown), or not_found (no reliable source either way).

Report through the report_presend tool. The summary is one plain sentence.$rupert_prompt$,
      'First version.',
      'claude'
    );
  end if;
end
$seed$;
