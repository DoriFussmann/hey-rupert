"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { connectInboxAppPasswordAction, pollInboxConnectAction, startInboxConnectAction } from "@/app/portal/setup/actions";
import {
  adminMessage,
  cleanAppPassword,
  clientIdFromAuthUrl,
  GOOGLE_2SV_URL,
  GOOGLE_ADMIN_URL,
  GOOGLE_APP_PASSWORDS_URL,
  SENDING_APP_NAME,
} from "@/lib/outreach/inbox-connect";

// Go Live, step 1: connect the inbox. Sign in with Google or Microsoft; when
// Google blocks the sign-in ("This app is blocked"), the same step offers the
// two ways out, so the client never has to write to Rupert to get unstuck:
// forward ready-made steps to their Google Workspace admin, or connect with a
// Google app password.

const POLL_MS = 3000;
const POLL_LIMIT_MS = 10 * 60 * 1000;
/** After this long in the sign-in window, the help is offered without being asked. */
const NUDGE_MS = 20_000;

const primary =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const secondary =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";
const field =
  "mt-xs w-full rounded-md border border-border bg-surface px-sm py-sm text-body-sm text-heading outline-none transition-colors duration-hover focus:border-primary";
const link = "text-primary underline underline-offset-2 hover:text-primary-hover";

type Way = "admin" | "password";

function Num({ n }: { n: number }) {
  return (
    <span className="mt-[2px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-tint text-[11px] font-medium text-primary-hover">
      {n}
    </span>
  );
}

function Steps({ children }: { children: React.ReactNode[] }) {
  return (
    <ol className="grid gap-sm">
      {children.map((child, index) => (
        <li key={index} className="flex gap-sm">
          <Num n={index + 1} />
          <div className="min-w-0 flex-1">{child}</div>
        </li>
      ))}
    </ol>
  );
}

export function ConnectInbox({
  readOnly,
  company,
  defaultEmail,
  defaultName,
}: {
  readOnly: boolean;
  company: string;
  defaultEmail: string;
  defaultName: string;
}) {
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [way, setWay] = useState<Way>("admin");
  const [clientId, setClientId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [email, setEmail] = useState(defaultEmail);
  const [name, setName] = useState(defaultName);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popupRef = useRef<Window | null>(null);
  const helpRef = useRef<HTMLDivElement | null>(null);

  function stopWaiting() {
    if (timer.current) clearTimeout(timer.current);
    if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
    timer.current = null;
    nudgeTimer.current = null;
    setConnecting(false);
    setNudge(false);
  }

  useEffect(() => stopWaiting, []); // eslint-disable-line react-hooks/exhaustive-deps

  function openHelp(which?: Way) {
    if (which) setWay(which);
    setHelp(true);
    requestAnimationFrame(() => helpRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }

  async function connect(provider: "google" | "microsoft") {
    setError(null);
    stopWaiting();
    // Opened on the click itself, so the browser doesn't block it.
    const popup = window.open("about:blank", "rupert-inbox", "width=520,height=680");
    popupRef.current = popup;
    setConnecting(true);
    const started = await startInboxConnectAction(provider);
    if (!started.ok) {
      popup?.close();
      setConnecting(false);
      setError(started.error);
      return;
    }
    if (provider === "google") setClientId(clientIdFromAuthUrl(started.authUrl) ?? clientId);
    if (popup) popup.location.href = started.authUrl;
    else window.open(started.authUrl, "_blank");
    if (provider === "google") nudgeTimer.current = setTimeout(() => setNudge(true), NUDGE_MS);
    const until = Date.now() + POLL_LIMIT_MS;
    const poll = async () => {
      const result = await pollInboxConnectAction();
      if (!result.ok) {
        stopWaiting();
        setError(result.error);
        return;
      }
      if (result.state === "connected") {
        stopWaiting();
        popup?.close();
        router.refresh();
        return;
      }
      if (result.state === "failed" || Date.now() > until) {
        stopWaiting();
        setError(result.message ?? "The sign-in timed out. Try again.");
        if (provider === "google") openHelp();
        return;
      }
      timer.current = setTimeout(poll, POLL_MS);
    };
    timer.current = setTimeout(poll, POLL_MS);
  }

  function blocked() {
    popupRef.current?.close();
    stopWaiting();
    setError(null);
    openHelp("admin");
  }

  const message = adminMessage({ company, clientId });

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied((current) => (current === what ? null : current)), 2500);
    } catch {
      setCopied(null);
    }
  }

  async function connectWithPassword(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!cleanAppPassword(password)) {
      setFormError("That isn't a Google app password. It is 16 letters, shown as four groups of four. Your normal Google password won't work here.");
      return;
    }
    setSaving(true);
    try {
      const result = await connectInboxAppPasswordAction({ email, name, password });
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      setPassword("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const tab = (which: Way, title: string, hint: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={way === which}
      onClick={() => setWay(which)}
      className={`flex-1 rounded-md px-md py-sm text-left transition-colors duration-hover ${
        way === which ? "bg-surface shadow-sm ring-1 ring-primary/40" : "hover:bg-surface/60"
      }`}
    >
      <span className={`block text-body-sm font-medium ${way === which ? "text-heading" : "text-secondary"}`}>{title}</span>
      <span className="block text-[12px] leading-snug text-muted">{hint}</span>
    </button>
  );

  return (
    <>
      <p className="max-w-prose">
        Sign in with the email account you use with investors. You sign in with Google or Microsoft directly; Rupert never sees your
        password.
      </p>
      <div className="mt-sm flex flex-wrap gap-sm">
        <button type="button" className={secondary} disabled={readOnly || connecting || saving} onClick={() => connect("google")}>
          Connect Google / Gmail
        </button>
        <button type="button" className={secondary} disabled={readOnly || connecting || saving} onClick={() => connect("microsoft")}>
          Connect Microsoft / Outlook
        </button>
      </div>

      {connecting ? (
        <div className="mt-sm flex flex-wrap items-center gap-x-sm gap-y-xs">
          <span className="inline-flex items-center gap-xs text-muted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary" aria-hidden />
            Finish signing in in the window that opened…
          </span>
          <button type="button" className={`${link} text-body-sm`} onClick={blocked}>
            {nudge ? "Stuck, or Google says “This app is blocked”? Here’s the fix" : "Google says “This app is blocked”?"}
          </button>
        </div>
      ) : !help ? (
        <button type="button" className={`${link} mt-sm block text-body-sm`} onClick={() => openHelp()}>
          Trouble connecting?
        </button>
      ) : null}

      {error ? <p className="mt-sm text-error">{error}</p> : null}

      {help ? (
        <div ref={helpRef} className="-ml-xl mt-md max-w-2xl overflow-hidden rounded-card border border-primary/30 bg-primary-tint/40 sm:ml-0">
          <div className="flex items-start justify-between gap-md px-md pt-md">
            <div>
              <p className="text-h4 text-heading">Google blocked the sign-in? Two ways to connect.</p>
              <p className="mt-xs text-body-sm text-secondary">
                Nothing is wrong with your account. Some Google accounts only allow apps their company has approved. Pick whichever is
                easier; both take a couple of minutes.
              </p>
            </div>
            <button type="button" className="shrink-0 text-muted hover:text-heading" aria-label="Close" onClick={() => setHelp(false)}>
              ✕
            </button>
          </div>

          <div role="tablist" className="mx-md mt-md flex flex-col gap-xs rounded-md bg-primary-tint p-xs sm:flex-row">
            {tab("admin", "Ask your Google admin", "Company email (Google Workspace)")}
            {tab("password", "Use an app password", "Personal Gmail, or no admin to ask")}
          </div>

          {way === "admin" ? (
            <div className="px-md py-md">
              <Steps>
                {[
                  <p key="a">
                    Send the ready-made steps to whoever manages your company&apos;s Google account. If that&apos;s you, open the{" "}
                    <a className={link} href={GOOGLE_ADMIN_URL} target="_blank" rel="noreferrer">
                      Google Admin console
                    </a>{" "}
                    and follow them yourself.
                  </p>,
                  <p key="b">
                    They mark the app <span className="text-heading">“{SENDING_APP_NAME}”</span> as <span className="text-heading">Trusted</span>.
                    It takes about two minutes.
                  </p>,
                  <p key="c">Wait five minutes, then connect again below. It will go straight through.</p>,
                ]}
              </Steps>

              <div className="mt-md rounded-md border border-border bg-surface">
                <div className="flex items-center justify-between gap-sm border-b border-border px-sm py-xs">
                  <span className="text-[12px] uppercase tracking-wide text-muted">For your admin</span>
                  <span className="flex shrink-0 gap-md whitespace-nowrap">
                    <button type="button" className={`${link} text-body-sm`} onClick={() => copy(message, "message")}>
                      {copied === "message" ? "Copied ✓" : "Copy"}
                    </button>
                    <a
                      className={`${link} text-body-sm`}
                      href={`mailto:?subject=${encodeURIComponent("Please trust one app in Google Workspace (2 minutes)")}&body=${encodeURIComponent(message)}`}
                    >
                      Email it
                    </a>
                  </span>
                </div>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap px-sm py-sm font-sans text-[13px] leading-relaxed text-secondary">{message}</pre>
              </div>

              <div className="mt-md flex flex-wrap items-center gap-sm">
                <button type="button" className={primary} disabled={readOnly || connecting} onClick={() => connect("google")}>
                  Done? Connect Google again
                </button>
                <button type="button" className={`${link} text-body-sm`} onClick={() => setWay("password")}>
                  No admin to ask? Use an app password
                </button>
              </div>
            </div>
          ) : (
            <form className="px-md py-md" onSubmit={connectWithPassword} autoComplete="off">
              <Steps>
                {[
                  <p key="a">
                    Make sure{" "}
                    <a className={link} href={GOOGLE_2SV_URL} target="_blank" rel="noreferrer">
                      2-Step Verification
                    </a>{" "}
                    is on for your Google account. Google requires it for app passwords.
                  </p>,
                  <p key="b">
                    Open{" "}
                    <a className={link} href={GOOGLE_APP_PASSWORDS_URL} target="_blank" rel="noreferrer">
                      Google app passwords
                    </a>
                    , name it <span className="text-heading">Rupert</span> and click Create. Google shows 16 letters.
                  </p>,
                  <div key="c">
                    <p>Paste them here.</p>
                    <div className="mt-sm grid gap-sm sm:grid-cols-2">
                      <label className="block text-[12px] uppercase tracking-wide text-muted">
                        Your name, as investors see it
                        <input className={field} value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly || saving} autoComplete="name" />
                      </label>
                      <label className="block text-[12px] uppercase tracking-wide text-muted">
                        Inbox email
                        <input
                          className={field}
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          disabled={readOnly || saving}
                          autoComplete="email"
                        />
                      </label>
                      <label className="block text-[12px] uppercase tracking-wide text-muted sm:col-span-2">
                        App password
                        <input
                          className={`${field} font-mono tracking-widest`}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="abcd efgh ijkl mnop"
                          disabled={readOnly || saving}
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="off"
                          spellCheck={false}
                          data-1p-ignore
                          data-lpignore="true"
                        />
                      </label>
                    </div>
                  </div>,
                ]}
              </Steps>

              {formError ? <p className="mt-sm text-error">{formError}</p> : null}

              <div className="mt-md flex flex-wrap items-center gap-sm">
                <button type="submit" className={primary} disabled={readOnly || saving || !email.trim() || !name.trim() || !password.trim()}>
                  {saving ? "Connecting…" : "Connect inbox"}
                </button>
                <button type="button" className={`${link} text-body-sm`} onClick={() => setWay("admin")}>
                  Company email? Ask your admin instead
                </button>
              </div>
              <p className="mt-sm max-w-prose text-[12px] leading-snug text-muted">
                An app password is not your Google password. It only lets Rupert&apos;s sending platform send and read mail for this inbox.
                It is passed straight to the platform and Rupert does not keep a copy. You can revoke it in your Google account at any
                time.
              </p>
            </form>
          )}
        </div>
      ) : null}
    </>
  );
}
