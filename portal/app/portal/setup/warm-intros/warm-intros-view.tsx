"use client";

import { useState } from "react";
import { updateWarmIntro } from "@/app/portal/setup/actions";
import { WARM_INTRO_STATUSES, type WarmIntroStatus } from "@/lib/outreach/campaign";
import type { KnownFund } from "@/lib/outreach/campaign-server";

const fieldClass =
  "w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary";

function FundCard({ fund, ask, blurb, readOnly }: { fund: KnownFund; ask: string; blurb: string; readOnly: boolean }) {
  const [status, setStatus] = useState<WarmIntroStatus>(fund.status);
  const [note, setNote] = useState(fund.client_note);
  const [saved, setSaved] = useState({ status: fund.status, note: fund.client_note });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const dirty = status !== saved.status || note !== saved.note;
  const message = [ask.replace(/\{\{\s*fund_name\s*\}\}/g, fund.fund_name), blurb].filter((part) => part.trim()).join("\n\n");

  async function save() {
    setPending(true);
    setError(null);
    try {
      const result = await updateWarmIntro(fund.firm_id, status, note);
      if (!result.ok) setError(result.error);
      else setSaved({ status, note });
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. Select the text and copy it instead.");
    }
  }

  return (
    <li className="rounded-card border border-border bg-surface px-lg py-lg">
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <h2 className="text-h4">{fund.fund_name}</h2>
        {fund.website ? (
          <a href={fund.website} target="_blank" rel="noreferrer" className="text-body-sm text-primary underline hover:text-primary-hover">
            Website
          </a>
        ) : null}
      </div>
      {fund.override ? (
        <p className="mt-sm rounded-md bg-primary-tint px-sm py-xs text-body-sm text-heading">
          Rupert added this fund to the email campaign, so it will also get an email from you.
        </p>
      ) : null}
      {fund.contacts.length ? (
        <p className="mt-sm text-body-sm text-secondary">
          <span className="text-heading">Who to ask about: </span>
          {fund.contacts.map((c) => [c.name, c.title].filter(Boolean).join(", ")).join("; ")}
        </p>
      ) : null}

      {message ? (
        <div className="mt-md">
          <p className="text-label uppercase tracking-label text-muted">A note to send your connector</p>
          <div className="mt-xs whitespace-pre-wrap rounded-md bg-background px-md py-sm text-body-sm text-body">{message}</div>
          <button type="button" className="mt-xs text-body-sm text-primary hover:text-primary-hover" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : null}

      <div className="mt-md grid gap-sm sm:grid-cols-[14rem_minmax(0,1fr)]">
        <label className="text-label uppercase tracking-label text-muted">
          Progress
          <select className={`${fieldClass} mt-xs normal-case tracking-normal`} value={status} disabled={readOnly} onChange={(e) => setStatus(e.target.value as WarmIntroStatus)}>
            {WARM_INTRO_STATUSES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-label uppercase tracking-label text-muted">
          Note for Rupert (optional)
          <input className={`${fieldClass} mt-xs normal-case tracking-normal`} value={note} maxLength={2000} disabled={readOnly} placeholder="Who you asked, what they said" onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <div className="mt-sm flex items-center gap-sm">
        <button
          type="button"
          className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
          disabled={readOnly || pending || !dirty}
          onClick={save}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {error ? <p role="alert" className="text-body-sm text-error">{error}</p> : null}
      </div>
    </li>
  );
}

export function WarmIntrosView({ funds, ask, blurb, readOnly }: { funds: KnownFund[]; ask: string; blurb: string; readOnly: boolean }) {
  return (
    <ul className="grid gap-md">
      {funds.map((fund) => (
        <FundCard key={fund.firm_id} fund={fund} ask={ask} blurb={blurb} readOnly={readOnly} />
      ))}
    </ul>
  );
}
