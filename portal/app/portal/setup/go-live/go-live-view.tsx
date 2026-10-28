"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { approveLaunchAction, pollInboxConnectAction, sendMeTestAction, startInboxConnectAction } from "@/app/portal/setup/actions";
import { formatDateTime } from "@/lib/format";
import { LiveBanner } from "@/components/live-banner";
import { LaunchTimeline } from "@/components/launch-timeline";
import { weekLabel, type PlanWeek } from "@/lib/outreach/live";

const POLL_MS = 3000;
const POLL_LIMIT_MS = 10 * 60 * 1000;

const primary =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const secondary =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children?: React.ReactNode }) {
  return (
    <li className="rounded-card border border-border bg-surface px-lg py-lg">
      <div className="flex items-center gap-sm">
        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-body-sm ${done ? "bg-primary text-white" : "border border-border text-muted"}`}>
          {done ? "✓" : n}
        </span>
        <h2 className="text-h4">{title}</h2>
      </div>
      {children ? <div className="mt-sm pl-xl text-body-sm text-secondary">{children}</div> : null}
    </li>
  );
}

export function GoLiveView({
  readOnly,
  campaignReady,
  inbox,
  invoice,
  live,
  gaps,
  consentText,
  counts,
  testSentAt,
  requested,
  plan,
  inboxEmail,
}: {
  readOnly: boolean;
  campaignReady: boolean;
  inbox: { email: string; healthy: boolean } | null;
  invoice: { url: string | null; paidAt: string | null };
  live: { at: string } | null;
  gaps: string[];
  consentText: string | null;
  counts: { funds: number; wave1: number; wave2: number };
  testSentAt: string | null;
  /** The client approved the launch; Rupert clicks Go Live within 24 hours. */
  requested: { at: string } | null;
  plan: PlanWeek[];
  inboxEmail: string | null;
}) {
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);
  const [consent, setConsent] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);

  async function sendTest() {
    setTesting(true);
    setError(null);
    setTestNote(null);
    try {
      const result = await sendMeTestAction();
      if (!result.ok) setError(result.error);
      else setTestNote(`On its way to ${result.to}: the three emails ${result.fund} would get, a couple of minutes apart.`);
    } finally {
      setTesting(false);
    }
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function connect(provider: "google" | "microsoft") {
    setError(null);
    // Opened on the click itself, so the browser doesn't block it.
    const popup = window.open("about:blank", "rupert-inbox", "width=520,height=680");
    setConnecting(true);
    const started = await startInboxConnectAction(provider);
    if (!started.ok) {
      popup?.close();
      setConnecting(false);
      setError(started.error);
      return;
    }
    if (popup) popup.location.href = started.authUrl;
    else window.open(started.authUrl, "_blank");
    const until = Date.now() + POLL_LIMIT_MS;
    const poll = async () => {
      const result = await pollInboxConnectAction();
      if (!result.ok) {
        setConnecting(false);
        setError(result.error);
        return;
      }
      if (result.state === "connected") {
        setConnecting(false);
        popup?.close();
        router.refresh();
        return;
      }
      if (result.state === "failed" || Date.now() > until) {
        setConnecting(false);
        setError(result.message ?? "The sign-in timed out. Try again.");
        return;
      }
      timer.current = setTimeout(poll, POLL_MS);
    };
    timer.current = setTimeout(poll, POLL_MS);
  }

  async function launch() {
    if (!window.confirm("Approve the launch? Rupert runs a final check and starts sending within 24 hours.")) return;
    setLaunching(true);
    setError(null);
    try {
      const result = await approveLaunchAction(consent);
      if (!result.ok) setError(result.error);
      else router.refresh();
    } finally {
      setLaunching(false);
    }
  }

  const total = counts.wave1 + counts.wave2;
  const lastFirst = [...plan].reverse().find((w) => w.newInvestors > 0);
  const lastWeek = plan[plan.length - 1];
  const planBlock =
    plan.length > 0 ? (
      <section className="mt-lg rounded-card border border-border bg-surface px-lg py-lg">
        <h2 className="text-h3">What happens next</h2>
        <div className="mt-md grid gap-md sm:grid-cols-3">
          <div className="rounded-card border border-border px-md py-md">
            <p className="text-label uppercase tracking-label text-muted">Investors</p>
            <p className="mt-xs font-mono text-h2 text-heading">{total}</p>
            <p className="text-body-sm text-muted">at {counts.funds} funds</p>
          </div>
          <div className="rounded-card border border-border px-md py-md">
            <p className="text-label uppercase tracking-label text-muted">First emails done</p>
            <p className="mt-xs font-mono text-h2 text-heading">Week {lastFirst?.week ?? 1}</p>
            <p className="text-body-sm text-muted">{lastFirst ? `by ${weekLabel(lastFirst.end, lastFirst.end)}` : ""}</p>
          </div>
          <div className="rounded-card border border-border px-md py-md">
            <p className="text-label uppercase tracking-label text-muted">Last follow-ups</p>
            <p className="mt-xs font-mono text-h2 text-heading">Week {lastWeek.week}</p>
            <p className="text-body-sm text-muted">by {weekLabel(lastWeek.end, lastWeek.end)}</p>
          </div>
        </div>
        <p className="mt-md max-w-prose text-body-sm text-secondary">
          Each investor gets a first email and up to two follow-ups, 5 days apart, in the same thread; anyone who replies gets no more.
          The pace starts low so your inbox builds a good sending record, and never goes above 30 emails a day.
          {live ? "" : " Dates assume sending starts the next weekday."}
        </p>
        <LaunchTimeline weeks={plan} live={Boolean(live)} requested={Boolean(requested)} />
      </section>
    ) : null;

  if (live) {
    return (
      <>
        <LiveBanner since={live.at}>
          <p className="max-w-prose text-body-sm text-secondary">
            New investors are added each weekday, mixed across your tiers; the second contact at a fund follows a few days
            after the first. Replies that need you appear in your Investor Inbox.
          </p>
          <Link href="/portal/live-campaign" className={`${primary} mt-md inline-block`}>
            Open Live Campaign
          </Link>
        </LiveBanner>
        {planBlock}
      </>
    );
  }

  if (requested) {
    return (
      <>
        <LiveBanner since={requested.at} word="Ready" sincePrefix="You approved the launch on">
          <p className="max-w-prose text-body text-body">
            Rupert runs a final check and starts sending within 24 hours. You&apos;ll get an email the moment your campaign is
            live, and this page turns Live.
          </p>
        </LiveBanner>
        <section className="mt-lg rounded-card border border-border bg-surface px-lg py-lg">
          <h2 className="text-h4">Done</h2>
          <ul className="mt-sm grid gap-xs text-body-sm">
            <li>✓ Inbox connected{inboxEmail ? `: ${inboxEmail}` : ""}</li>
            <li>✓ First monthly invoice paid</li>
            <li>✓ Launch approved by you</li>
            <li className="text-muted">○ Rupert starts sending</li>
          </ul>
        </section>
        {planBlock}
      </>
    );
  }

  const ready = gaps.length === 0;

  return (
    <>
      {!campaignReady ? (
        <p className="mb-md rounded-card border border-border bg-primary-tint px-lg py-md text-body-sm text-heading">
          Rupert is finishing your campaign. You can connect your inbox now.
        </p>
      ) : (
        <p className="mb-md text-body-sm text-secondary">
          Your campaign is ready: {counts.wave1 + counts.wave2} investors at {counts.funds} funds.
        </p>
      )}
      <ol className="grid gap-md">
        <Step n={1} done={Boolean(inbox?.healthy)} title="Connect your inbox">
          {inbox ? (
            <p>
              Connected: <span className="text-heading">{inbox.email}</span>
              {inbox.healthy ? "" : ". Rupert is checking it and will be in touch if anything is needed."}
            </p>
          ) : (
            <>
              <p className="max-w-prose">
                Sign in with the email account you use with investors. You sign in with Google or Microsoft directly; your
                password is never shared with Rupert.
              </p>
              <div className="mt-sm flex flex-wrap gap-sm">
                <button type="button" className={secondary} disabled={readOnly || connecting} onClick={() => connect("google")}>
                  Connect Google / Gmail
                </button>
                <button type="button" className={secondary} disabled={readOnly || connecting} onClick={() => connect("microsoft")}>
                  Connect Microsoft / Outlook
                </button>
              </div>
              {connecting ? <p className="mt-xs text-muted">Finish signing in in the window that opened…</p> : null}
            </>
          )}
        </Step>
        <Step n={2} done={Boolean(invoice.paidAt)} title="Pay the first monthly invoice">
          {invoice.paidAt ? (
            <p>Paid {formatDateTime(invoice.paidAt)}.</p>
          ) : invoice.url ? (
            <>
              <p>Paying it confirms you want to launch, as in your Service Order.</p>
              <a href={invoice.url} target="_blank" rel="noreferrer" className={`${secondary} mt-sm inline-block`}>
                Pay invoice
              </a>
            </>
          ) : (
            <p>Rupert sends it when your campaign is ready.</p>
          )}
        </Step>
        <Step n={3} done={false} title="Review and approve the launch">
          <ul className="mb-md max-w-prose list-disc pl-lg">
            <li>
              Never more than 30 emails a day from your inbox, follow-ups included, building up from 10 a day. New investors are
              added each weekday, mixed across your tiers, until all {total} are reached. The second contact at a fund starts a few
              days after the first.
            </li>
            <li>Once you approve, Rupert runs a final check and starts sending within 24 hours. You&apos;re emailed when it&apos;s live.</li>
            <li>Each investor gets the first email and up to two follow-ups, as replies in the same thread. Anyone who replies gets no more follow-ups.</li>
            <li>Emails go out from your inbox, in your name. Rupert reads every reply first; the ones that need you appear in your Investor Inbox.</li>
          </ul>
          {inbox ? (
            <div className="mb-md">
              <button type="button" className={secondary} disabled={readOnly || testing || !campaignReady} onClick={sendTest}>
                {testing ? "Sending…" : "Send me a test"}
              </button>
              <span className="ml-sm text-muted">
                {testNote ?? (testSentAt ? `Last test ${formatDateTime(testSentAt)}.` : "Optional: see exactly what an investor gets, in your own inbox.")}
              </span>
            </div>
          ) : null}
          {consentText ? (
            <label className="flex max-w-prose items-start gap-sm">
              <input type="checkbox" className="mt-1" checked={consent} disabled={readOnly || !ready} onChange={(e) => setConsent(e.target.checked)} />
              <span>{consentText}</span>
            </label>
          ) : (
            <p>Connect your inbox first.</p>
          )}
          {!ready ? (
            <ul className="mt-sm list-disc pl-lg text-muted">
              {gaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          ) : null}
          <button type="button" className={`${primary} mt-md`} disabled={readOnly || !ready || !consent || launching} onClick={launch}>
            {launching ? "Approving…" : "Approve launch"}
          </button>
        </Step>
      </ol>
      {planBlock}
      {error ? <p role="alert" className="mt-md text-body-sm text-error">{error}</p> : null}
    </>
  );
}
