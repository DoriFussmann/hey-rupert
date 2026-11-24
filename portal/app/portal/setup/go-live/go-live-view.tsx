"use client";

import Link from "next/link";
import { useState } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { approveLaunchAction, sendMeTestAction } from "@/app/portal/setup/actions";
import { formatDateTime } from "@/lib/format";
import { LiveBanner } from "@/components/live-banner";
import { ConnectInbox } from "@/app/portal/setup/go-live/connect-inbox";
import { LaunchTimeline } from "@/components/launch-timeline";
import { LAUNCH_VT, LaunchDoneRow } from "@/components/launch-done-row";
import { MarkdownBody } from "@/components/markdown-body";
import { postalAddressProblem, withPostalAddress } from "@/lib/launch-confirmation";
import { weekLabel, type PlanWeek } from "@/lib/outreach/live";

const primary =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const secondary =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

function Step({ n, done, title, vt, children }: { n: number; done: boolean; title: string; vt: string; children?: React.ReactNode }) {
  return (
    <li className="rounded-card border border-border bg-surface px-lg py-lg" style={{ viewTransitionName: vt }}>
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
  confirmation,
  company,
  contactEmail,
  contactName,
}: {
  company: string;
  contactEmail: string;
  contactName: string;
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
  /** The Launch Confirmation for this client (postal address still to fill in), and what they confirmed. */
  confirmation: { text: string; postalAddress: string; confirmed: { at: string; text: string } | null } | null;
}) {
  const router = useRouter();
  const [consent, setConsent] = useState(false);
  const [address, setAddress] = useState(confirmation?.postalAddress ?? "");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);
  // Set the moment the client approves, so the page turns into the approved
  // view at once, with the celebration, before the server data catches up.
  const [approvedAt, setApprovedAt] = useState<string | null>(null);

  async function sendTest() {
    setTesting(true);
    setError(null);
    setTestNote(null);
    try {
      const result = await sendMeTestAction();
      if (!result.ok) setError(result.error);
      else
        setTestNote(
          `On its way to ${result.to}, and only to you: the first email ${result.fund} would get, then its follow-up a couple of minutes later as a reply in the same thread. No investor receives anything.`,
        );
    } finally {
      setTesting(false);
    }
  }

  async function launch() {
    const problem = postalAddressProblem(address);
    if (problem) {
      setError(problem);
      return;
    }
    if (!window.confirm("Confirm the Launch Confirmation and approve the launch? Rupert runs a final check and starts sending within 24 hours.")) return;
    setLaunching(true);
    setError(null);
    try {
      const result = await approveLaunchAction(consent, address);
      if (!result.ok) setError(result.error);
      else celebrate();
    } finally {
      setLaunching(false);
    }
  }

  // The steps collapse to the top and morph into the three tiles (a view
  // transition where the browser has one), then What Happens Next rises in.
  function celebrate() {
    const at = new Date().toISOString();
    const show = () => {
      flushSync(() => setApprovedAt(at));
      window.scrollTo({ top: 0 });
    };
    const doc = document as Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (doc.startViewTransition && !reduced) {
      doc.startViewTransition(show).finished.finally(() => setTimeout(() => router.refresh(), 2600));
    } else {
      show();
      setTimeout(() => router.refresh(), 2600);
    }
  }

  const approved = requested ?? (approvedAt ? { at: approvedAt } : null);
  const celebrating = Boolean(approvedAt);
  const dayOf = (at: string | null | undefined) =>
    at ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(at)) : "Done";
  const doneRow = (celebrate: boolean) => (
    <LaunchDoneRow
      inboxEmail={inboxEmail ?? inbox?.email ?? null}
      paidOn={invoice.paidAt ? `Paid ${dayOf(invoice.paidAt)}` : "Paid"}
      confirmedOn={`Confirmed ${dayOf(confirmation?.confirmed?.at ?? approved?.at)}`}
      celebrate={celebrate}
    />
  );

  const total = counts.wave1 + counts.wave2;
  const lastFirst = [...plan].reverse().find((w) => w.newInvestors > 0);
  const lastWeek = plan[plan.length - 1];
  const planBlock =
    plan.length > 0 ? (
      <section className="mt-lg rounded-card border border-border bg-surface px-lg py-lg">
        <h2 className="text-h3">What Happens Next</h2>
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
          Each investor gets a first email and a follow-up 5 business days later, in the same thread; anyone who replies gets no more.
          The pace starts at up to 15 emails a day for the first 10 business days, so your inbox builds a good sending record, and
          never goes above 30 emails a day.
          {live ? "" : " Dates assume sending starts the next weekday."}
        </p>
        <LaunchTimeline weeks={plan} live={Boolean(live)} requested={Boolean(requested)} />
      </section>
    ) : null;

  const confirmedBlock = confirmation?.confirmed ? (
    <details className="mt-lg rounded-card border border-border bg-surface px-lg py-md">
      <summary className="cursor-pointer text-body-sm text-primary">
        Your Launch Confirmation, confirmed {formatDateTime(confirmation.confirmed.at)}
      </summary>
      <div className="mt-md">
        <MarkdownBody content={confirmation.confirmed.text} emptyLabel="" />
      </div>
    </details>
  ) : null;

  if (live) {
    return (
      <>
        <div className="mb-lg">{doneRow(false)}</div>
        <LiveBanner since={live.at}>
          <p className="max-w-prose text-body-sm text-secondary">
            New investors are added each weekday, mixed across your tiers; the second contact at a fund follows a few days
            after the first. Replies that need you appear in your Investor Inbox.
          </p>
          <Link href="/portal/live-campaign" className={`${primary} mt-md inline-block`}>
            Open Live Campaign
          </Link>
        </LiveBanner>
        {confirmedBlock}
        {planBlock}
      </>
    );
  }

  if (approved) {
    return (
      <>
        <div className="mb-lg">{doneRow(celebrating)}</div>
        <div className={celebrating ? "launch-rise launch-rise-1" : ""}>
          <LiveBanner since={approved.at} word="Ready" sincePrefix="You approved the launch on">
            <p className="max-w-prose text-body text-body">
              Rupert runs a final check and starts sending within 24 hours. You&apos;ll get an email the moment your campaign is
              live, and this page turns Live.
            </p>
          </LiveBanner>
        </div>
        <div className={celebrating ? "launch-rise launch-rise-2" : ""}>{planBlock}</div>
        <div className={celebrating ? "launch-rise launch-rise-3" : ""}>{confirmedBlock}</div>
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
        <Step n={1} done={Boolean(inbox?.healthy)} title="Connect your inbox" vt={LAUNCH_VT.inbox}>
          {inbox ? (
            <p>
              Connected: <span className="text-heading">{inbox.email}</span>
              {inbox.healthy ? "" : ". Rupert is checking it and will be in touch if anything is needed."}
            </p>
          ) : (
            <ConnectInbox readOnly={readOnly} company={company} defaultEmail={contactEmail} defaultName={contactName} />
          )}
        </Step>
        <Step n={2} done={Boolean(invoice.paidAt)} title="Pay the first monthly invoice" vt={LAUNCH_VT.invoice}>
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
        <Step n={3} done={false} title="Confirm and approve the launch" vt={LAUNCH_VT.confirm}>
          <ul className="mb-md max-w-prose list-disc pl-lg">
            <li>
              Up to 15 emails a day from your inbox for the first 10 business days, then never more than 30 a day, follow-ups
              included. New investors are added each weekday, mixed across your tiers, until all {total} are reached.
            </li>
            <li>Each investor gets a first email and a follow-up 5 business days later, in the same thread. Anyone who replies gets no follow-up.</li>
            <li>Emails go out from your inbox, in your name. Rupert reads every reply first; the ones that need you appear in your Investor Inbox.</li>
            <li>Once you approve, Rupert runs a final check and starts sending within 24 hours. You&apos;re emailed when it&apos;s live.</li>
          </ul>
          {inbox ? (
            <div className="mb-md">
              <button type="button" className={secondary} disabled={readOnly || testing || !campaignReady} onClick={sendTest}>
                {testing ? "Sending…" : "Send me a test"}
              </button>
              <span className="ml-sm text-muted">
                {testNote ?? (testSentAt ? `Last test ${formatDateTime(testSentAt)}.` : "Optional: see exactly what an investor gets. Two emails arrive in your own inbox: the first email, then the follow-up a couple of minutes later in the same thread. Only you receive them.")}
              </span>
            </div>
          ) : null}
          {confirmation && consentText ? (
            <>
              <label className="block max-w-prose">
                <span className="text-heading">Your company&apos;s postal address</span>
                <span className="block text-muted">
                  US law requires it: under the CAN-SPAM Act, a commercial email must carry the sender&apos;s valid postal address
                  and a way to opt out. It goes at the foot of each first email, with a line that lets an investor opt out. A
                  street address or a P.O. box both work.
                </span>
                <input
                  className="mt-xs w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none"
                  value={address}
                  disabled={readOnly}
                  maxLength={200}
                  placeholder="Street or P.O. box, city, state, postal code"
                  onChange={(e) => setAddress(e.target.value)}
                />
              </label>
              <p className="mt-md text-heading">Launch Confirmation</p>
              <div className="sow-compact mt-xs max-h-[420px] max-w-prose overflow-y-auto rounded-md border border-border bg-background px-md py-md">
                <MarkdownBody content={withPostalAddress(confirmation.text, address)} emptyLabel="" />
              </div>
              <label className="mt-md flex max-w-prose items-start gap-sm">
                <input type="checkbox" className="mt-1" checked={consent} disabled={readOnly || !ready} onChange={(e) => setConsent(e.target.checked)} />
                <span>I have read and confirm the Launch Confirmation above. {consentText}</span>
              </label>
            </>
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
          <button type="button" className={`${primary} mt-md`} disabled={readOnly || !ready || !consent || launching || !confirmation} onClick={launch}>
            {launching ? "Approving…" : "Confirm and approve launch"}
          </button>
        </Step>
      </ol>
      {planBlock}
      {error ? <p role="alert" className="mt-md text-body-sm text-error">{error}</p> : null}
    </>
  );
}
