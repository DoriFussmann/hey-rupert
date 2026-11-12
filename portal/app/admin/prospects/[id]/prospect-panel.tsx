"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  draftProspectFollowUp,
  refreshProspectBrief,
  resendProspectPrep,
  saveProspectOutcome,
  sendProspectFollowUp,
  updateProspectEstimate,
} from "@/app/admin/prospect-actions";
import { OUTCOMES, filtersLine, type FitOptions, type MatchEstimate, type ProspectBrief, type ProspectStatus } from "@/lib/prospects/core";

export type PanelProspect = {
  id: string;
  email: string;
  name: string | null;
  status: ProspectStatus;
  brief: ProspectBrief | null;
  briefStatus: "pending" | "running" | "ready" | "failed";
  briefError: string | null;
  briefAt: string | null;
  match: MatchEstimate | null;
  outcomeNotes: string | null;
  outcomeAt: string | null;
  followUp: { subject: string; body: string; draftedAt: string } | null;
  followUpSentAt: string | null;
  converted: boolean;
};

const card = "rounded-card border border-border bg-surface px-lg py-md";
const label = "text-label uppercase tracking-label text-muted";
const primary = "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const secondary = "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";
const field = "mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none";

const dateText = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "";

function List({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="mt-xs list-disc pl-lg text-body-sm text-body">
      {items.map((item, i) => (
        <li key={i} className="mb-xs">
          {item}
        </li>
      ))}
    </ul>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-md">
      <p className={label}>{title}</p>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function BriefAndFit({ prospect, options, optionsError }: { prospect: PanelProspect; options: FitOptions | null; optionsError: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const b = prospect.brief;

  function refresh() {
    setError(null);
    setNotice(null);
    start(async () => {
      const r = await refreshProspectBrief(prospect.id);
      if (!r.ok) setError(r.error);
      else {
        setNotice("Brief updated. A prep email still waiting to go out now carries it.");
        router.refresh();
      }
    });
  }

  return (
    <div className="grid content-start gap-lg">
      <section className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-sm">
          <h2 className="text-h4">Prep brief</h2>
          <div className="flex items-center gap-sm">
            {prospect.briefAt ? <span className="text-body-sm text-muted">{dateText(prospect.briefAt)}</span> : null}
            <button type="button" className={secondary} onClick={refresh} disabled={pending}>
              {pending ? "Researching… (1–2 min)" : b ? "Refresh brief" : "Write brief"}
            </button>
          </div>
        </div>
        {error ? <p className="mt-sm text-body-sm text-error">{error}</p> : null}
        {notice ? <p className="mt-sm text-body-sm text-success">{notice}</p> : null}
        {!b ? (
          <p className="mt-sm text-body-sm text-muted">
            {prospect.briefStatus === "failed"
              ? `The brief failed: ${prospect.briefError ?? "unknown error"}.`
              : prospect.briefStatus === "running"
                ? "Researching the founder and the company…"
                : "No brief yet."}
          </p>
        ) : (
          <>
            {b.company.oneLiner ? <p className="mt-sm text-body text-heading">{b.company.oneLiner}</p> : null}
            {b.company.what ? <p className="mt-xs text-body-sm text-body">{b.company.what}</p> : null}
            <p className="mt-xs text-body-sm text-muted">
              {[b.company.hqCountry && `HQ ${b.company.hqCountry}`, b.company.founded && `Founded ${b.company.founded}`, (b.raise.stage || b.raise.amount) && `Raising ${[b.raise.stage, b.raise.amount].filter(Boolean).join(", ")}`]
                .filter(Boolean)
                .join(" · ")}
              {b.company.website ? (
                <>
                  {" · "}
                  <a href={b.company.website} target="_blank" rel="noreferrer" className="text-primary">
                    {b.company.website.replace(/^https?:\/\//, "")}
                  </a>
                </>
              ) : null}
            </p>
            {b.person.summary || b.person.facts.length ? (
              <Block title="The founder">
                <p className="mt-xs text-body-sm text-body">{b.person.summary}</p>
                <List items={b.person.facts} />
              </Block>
            ) : null}
            {b.company.rounds.length ? (
              <Block title="Rounds">
                <List items={b.company.rounds.map((r) => [r.round, r.amount, r.date].filter(Boolean).join(", ") + (r.investors ? `: ${r.investors}` : ""))} />
              </Block>
            ) : null}
            {b.signals.length ? (
              <Block title="Signals">
                <List items={b.signals} />
              </Block>
            ) : null}
            {b.questions.length ? (
              <Block title="Ask on the call">
                <ol className="mt-xs list-decimal pl-lg text-body-sm text-body">
                  {b.questions.map((q, i) => (
                    <li key={i} className="mb-xs">
                      {q}
                    </li>
                  ))}
                </ol>
              </Block>
            ) : null}
            {b.watchOuts.length ? (
              <Block title="Watch out">
                <List items={b.watchOuts} />
              </Block>
            ) : null}
            {b.sources.length ? (
              <Block title="Sources">
                <ul className="mt-xs text-body-sm">
                  {b.sources.map((s) => (
                    <li key={s.url} className="truncate">
                      <a href={s.url} target="_blank" rel="noreferrer" className="text-primary">
                        {s.title || s.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </Block>
            ) : null}
          </>
        )}
      </section>

      <FitCard prospect={prospect} options={options} optionsError={optionsError} />
    </div>
  );
}

// ---------------------------------------------------------------------------

type FitKey = "financing" | "stage" | "geography" | "sector";
const FIT_STEPS: { key: FitKey; label: string }[] = [
  { key: "financing", label: "Financing" },
  { key: "stage", label: "Stage" },
  { key: "geography", label: "Geography" },
  { key: "sector", label: "Sector" },
];

function FitCard({ prospect, options, optionsError }: { prospect: PanelProspect; options: FitOptions | null; optionsError: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = prospect.brief?.fit ?? { financing: ["financing.equity"], stage: [], geography: [], sector: [], note: "" };
  const [fit, setFit] = useState<Record<FitKey, string[]>>({
    financing: base.financing.length ? base.financing : ["financing.equity"],
    stage: base.stage,
    geography: base.geography,
    sector: base.sector,
  });
  const m = prospect.match;

  function toggle(key: FitKey, id: string) {
    setFit((current) => ({ ...current, [key]: current[key].includes(id) ? current[key].filter((x) => x !== id) : [...current[key], id] }));
  }

  function apply() {
    setError(null);
    start(async () => {
      const r = await updateProspectEstimate(prospect.id, { ...fit, note: base.note });
      if (!r.ok) setError(r.error);
      else {
        setEditing(false);
        router.refresh();
      }
    });
  }

  return (
    <section className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <h2 className="text-h4">Investor fit · first estimate</h2>
        {options ? (
          <button type="button" className={secondary} onClick={() => setEditing((v) => !v)} disabled={pending}>
            {editing ? "Close" : "Change filters"}
          </button>
        ) : null}
      </div>
      {!m ? (
        <p className="mt-sm text-body-sm text-muted">No estimate yet: it runs with the brief.</p>
      ) : (
        <>
          <p className="mt-sm text-h2 font-light text-heading">
            ~{m.count.toLocaleString("en-US")}{" "}
            <span className="text-body-sm text-muted">of {m.total.toLocaleString("en-US")} funds fit</span>
          </p>
          <p className="text-body-sm text-muted">
            {filtersLine(m)}
            {m.open.length ? ` · open: ${m.open.join(", ")}` : ""}
          </p>
          <ol className="mt-sm grid gap-xs text-body-sm">
            {m.steps.map((s) => (
              <li key={s.step} className="flex justify-between gap-md border-b border-border pb-xs last:border-b-0">
                <span className="text-body">
                  {s.label}: <span className="text-muted">{s.chosen.join(", ")}</span>
                </span>
                <span className="text-body">{s.left.toLocaleString("en-US")} left</span>
              </li>
            ))}
          </ol>
          {m.examples.length ? (
            <Block title="Examples">
              <ul className="mt-xs grid gap-xs text-body-sm">
                {m.examples.map((f) => (
                  <li key={f.name}>
                    {f.website ? (
                      <a href={f.website} target="_blank" rel="noreferrer" className="text-primary">
                        {f.name}
                      </a>
                    ) : (
                      f.name
                    )}
                    <span className="text-muted">{[f.type, f.place].filter(Boolean).length ? ` · ${[f.type, f.place].filter(Boolean).join(", ")}` : ""}</span>
                  </li>
                ))}
              </ul>
            </Block>
          ) : null}
          {prospect.brief?.fit.note ? <p className="mt-sm text-body-sm text-muted">{prospect.brief.fit.note}</p> : null}
          <p className="mt-sm text-body-sm text-muted">Dry Match on the live Fund Database, before any profile or review. A rough count to talk about, not a list.</p>
        </>
      )}
      {optionsError ? <p className="mt-sm text-body-sm text-error">{optionsError}</p> : null}
      {editing && options ? (
        <div className="mt-md grid gap-md border-t border-border pt-md">
          {FIT_STEPS.map(({ key, label: stepLabel }) => (
            <div key={key}>
              <p className={label}>{stepLabel}</p>
              <div className="mt-xs flex flex-wrap gap-xs">
                {options[key]
                  .filter((o) => key !== "stage" || !o.id.startsWith("stage.pe."))
                  .map((o) => {
                    const on = fit[key].includes(o.id);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => toggle(key, o.id)}
                        className={`rounded-full border px-sm py-xs text-body-sm transition-colors duration-hover ${on ? "border-primary bg-primary-tint text-primary" : "border-border text-secondary hover:text-heading"}`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
          {error ? <p className="text-body-sm text-error">{error}</p> : null}
          <div>
            <button type="button" className={primary} onClick={apply} disabled={pending}>
              {pending ? "Counting…" : "Update estimate"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------

export function AfterCall({ prospect }: { prospect: PanelProspect }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const initialOutcome = OUTCOMES.some((o) => o.value === prospect.status) ? prospect.status : "";
  const [outcome, setOutcome] = useState<string>(initialOutcome);
  const [notes, setNotes] = useState(prospect.outcomeNotes ?? "");
  const [subject, setSubject] = useState(prospect.followUp?.subject ?? "");
  const [body, setBody] = useState(prospect.followUp?.body ?? "");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function run(name: string, task: () => Promise<{ ok: boolean; error?: string } | { ok: true }>, done?: string) {
    setError(null);
    setNotice(null);
    setBusy(name);
    start(async () => {
      const r = (await task()) as { ok: boolean; error?: string };
      setBusy(null);
      if (!r.ok) setError(r.error ?? "Something went wrong.");
      else {
        if (done) setNotice(done);
        router.refresh();
      }
    });
  }

  const draft = () =>
    run("draft", async () => {
      if (notes.trim() !== (prospect.outcomeNotes ?? "").trim() || outcome !== initialOutcome) {
        if (!outcome) return { ok: false, error: "Choose the outcome first." };
        const saved = await saveProspectOutcome(prospect.id, outcome, notes);
        if (!saved.ok) return saved;
      }
      const r = await draftProspectFollowUp(prospect.id);
      if (r.ok) {
        setSubject(r.subject);
        setBody(r.body);
      }
      return r;
    });

  return (
    <>
      {!prospect.converted ? (
        <section className={card}>
          <h2 className="text-h4">After the call</h2>
          <label className={`mt-sm block ${label}`}>
            Outcome
            <select className={field} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="">Choose…</option>
              {OUTCOMES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className={`mt-md block ${label}`}>
            Notes
            <textarea
              className={`${field} min-h-[140px]`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What they need, what you agreed, next step."
            />
          </label>
          <div className="mt-md flex flex-wrap gap-sm">
            <button
              type="button"
              className={primary}
              disabled={pending || !outcome}
              onClick={() => run("save", () => saveProspectOutcome(prospect.id, outcome, notes), "Saved.")}
            >
              {busy === "save" ? "Saving…" : "Save outcome"}
            </button>
            <button type="button" className={secondary} disabled={pending || !notes.trim()} onClick={draft}>
              {busy === "draft" ? "Drafting…" : prospect.followUp ? "Redraft follow-up" : "Draft follow-up"}
            </button>
          </div>
          {prospect.outcomeAt ? <p className="mt-sm text-body-sm text-muted">Last saved {dateText(prospect.outcomeAt)}.</p> : null}
          <p className="mt-xs text-body-sm text-muted">A good-fit prospect who isn&apos;t a client 3 days later gets you one reminder email.</p>
        </section>
      ) : null}

      {subject || body ? (
        <section className={card}>
          <div className="flex flex-wrap items-baseline justify-between gap-sm">
            <h2 className="text-h4">Follow-up email</h2>
            {prospect.followUpSentAt ? <span className="text-body-sm text-success">Sent {dateText(prospect.followUpSentAt)}</span> : null}
          </div>
          <label className={`mt-sm block ${label}`}>
            Subject
            <input className={field} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label className={`mt-md block ${label}`}>
            Body
            <textarea className={`${field} min-h-[220px]`} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <div className="mt-md flex flex-wrap items-center gap-sm">
            {confirming ? (
              <>
                <button
                  type="button"
                  className={primary}
                  disabled={pending}
                  onClick={() =>
                    run(
                      "send",
                      async () => {
                        const r = await sendProspectFollowUp(prospect.id, subject, body);
                        setConfirming(false);
                        return r;
                      },
                      `Sent to ${prospect.email}.`,
                    )
                  }
                >
                  {busy === "send" ? "Sending…" : `Yes, send to ${prospect.email}`}
                </button>
                <button type="button" className={secondary} onClick={() => setConfirming(false)} disabled={pending}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className={primary} disabled={pending || !subject.trim() || !body.trim()} onClick={() => setConfirming(true)}>
                {prospect.followUpSentAt ? "Send again" : "Send"}
              </button>
            )}
          </div>
          <p className="mt-xs text-body-sm text-muted">Sent from Rupert&apos;s address, with a copy to you.</p>
        </section>
      ) : null}

      <section className={card}>
        <h2 className="text-h4">Prep email</h2>
        <p className="mt-xs text-body-sm text-muted">Goes to you 30 minutes before each call, with the brief and the estimate. Send it again to get the latest version now, or to replace one still waiting.</p>
        <button
          type="button"
          className={`${secondary} mt-sm`}
          disabled={pending}
          onClick={() =>
            run("prep", async () => {
              const r = await resendProspectPrep(prospect.id);
              if (r.ok && r.scheduled === 0) return { ok: false, error: r.notes[0] ?? "No upcoming call to send it for." };
              return r;
            }, "Prep email sent or rescheduled.")
          }
        >
          {busy === "prep" ? "Sending…" : "Send prep email again"}
        </button>
      </section>

      {error ? <p className="text-body-sm text-error">{error}</p> : null}
      {notice ? <p className="text-body-sm text-success">{notice}</p> : null}
    </>
  );
}
