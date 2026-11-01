"use client";

import { useCallback, useEffect, useState } from "react";
import { loadLandscape, saveLandscape, showCompetitors, startOverLandscape } from "@/app/admin/landscape-actions";
import type { Competitor, LinkState } from "@/lib/match/landscape/core";
import { MAX_COMPETITORS } from "@/lib/match/landscape/core";
import type { Landscape } from "@/lib/match/landscape/server";
import { inputClass, labelClass, primaryButton, secondaryButton, smallButton } from "@/app/admin/clients/[id]/match/ui";
import { BigNumber, Card } from "@/app/admin/matching/dry-match";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "");

const LINK_LOOK: Record<LinkState, { text: string; tone: string }> = {
  live: { text: "opens", tone: "text-success" },
  broken: { text: "broken", tone: "text-error" },
  unchecked: { text: "couldn't check", tone: "text-warning" },
};

function LinkLine({ label, url, state, title }: { label: string; url: string; state: LinkState; title?: string }) {
  if (!url) return <p className="text-body-sm text-error">{label}: none found</p>;
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  })();
  return (
    <p className="text-body-sm">
      <span className="text-muted">{label}: </span>
      <a href={url} target="_blank" rel="noreferrer noopener" className="text-primary underline hover:text-primary-hover">
        {title || host}
      </a>{" "}
      <span className={`text-label uppercase tracking-label ${LINK_LOOK[state].tone}`}>· {LINK_LOOK[state].text}</span>
    </p>
  );
}

const blank = (): Competitor => ({
  id: `new-${Math.random().toString(36).slice(2)}`,
  name: "",
  website: "",
  oneLiner: "",
  hq: "",
  stage: "",
  geography: "",
  primarySector: "",
  source: "web",
  why: "",
  funding: { totalRaised: "", lastRound: "", lastRoundDate: "", investors: [] },
  newsUrl: "",
  newsTitle: "",
  links: { website: "unchecked", news: "unchecked" },
});

function EditForm({ value, onSave, onCancel }: { value: Competitor; onSave: (c: Competitor) => void; onCancel: () => void }) {
  const [c, setC] = useState(value);
  const [investors, setInvestors] = useState(value.funding.investors.join(", "));
  const field = (label: string, input: React.ReactNode, wide = false) => (
    <label className={`block ${wide ? "md:col-span-2" : ""}`}>
      <span className={labelClass}>{label}</span>
      <div className="mt-xs">{input}</div>
    </label>
  );
  const text = (key: "name" | "website" | "hq" | "newsUrl" | "newsTitle" | "oneLiner" | "stage" | "geography" | "primarySector") => (
    <input className={inputClass} value={c[key]} onChange={(e) => setC({ ...c, [key]: e.target.value })} />
  );
  const fund = (key: "totalRaised" | "lastRound" | "lastRoundDate") => (
    <input className={inputClass} value={c.funding[key]} onChange={(e) => setC({ ...c, funding: { ...c.funding, [key]: e.target.value } })} />
  );
  return (
    <div className="grid gap-sm md:grid-cols-2">
      {field("Name", text("name"))}
      {field("Website", text("website"))}
      {field("Funding news link", text("newsUrl"))}
      {field("Funding news title", text("newsTitle"))}
      {field("Last round", fund("lastRound"))}
      {field("Last round date", fund("lastRoundDate"))}
      {field("Total raised", fund("totalRaised"))}
      {field("HQ", text("hq"))}
      {field("Stage (latest round)", text("stage"))}
      {field("Geography (HQ country)", text("geography"))}
      {field("Primary sector", text("primarySector"))}
      {field("Investors (comma separated)", <input className={inputClass} value={investors} onChange={(e) => setInvestors(e.target.value)} />, true)}
      {field("What it does", text("oneLiner"), true)}
      {field(
        "Why it's a direct competitor",
        <textarea className={inputClass} rows={2} value={c.why} onChange={(e) => setC({ ...c, why: e.target.value })} />,
        true,
      )}
      <div className="flex gap-sm md:col-span-2">
        <button
          type="button"
          className={primaryButton}
          disabled={!c.name.trim()}
          onClick={() =>
            onSave({
              ...c,
              funding: { ...c.funding, investors: investors.split(",").map((s) => s.trim()).filter(Boolean) },
              links: c.website === value.website && c.newsUrl === value.newsUrl ? c.links : { website: "unchecked", news: "unchecked" },
            })
          }
        >
          Done
        </button>
        <button type="button" className={secondaryButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Row({
  c,
  rank,
  locked,
  editing,
  onEdit,
  onSave,
  onCancel,
  onRemove,
  onMove,
  first,
  last,
}: {
  c: Competitor;
  rank: number;
  locked: boolean;
  editing: boolean;
  onEdit: () => void;
  onSave: (c: Competitor) => void;
  onCancel: () => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  first: boolean;
  last: boolean;
}) {
  const funding = [c.funding.lastRound, c.funding.lastRoundDate].filter(Boolean).join(", ");
  return (
    <li className="rounded-card border border-border bg-surface px-md py-sm">
      {editing ? (
        <EditForm value={c} onSave={onSave} onCancel={onCancel} />
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-md">
          <div className="min-w-0 flex-1 space-y-xs">
            <p className="text-h4 text-heading">
              <span className="mr-sm text-muted">{rank}.</span>
              {c.name}
              <span
                className={`ml-sm rounded-full px-sm py-[2px] align-middle text-label uppercase tracking-label ${c.source === "client" ? "bg-primary-tint text-primary" : "bg-background text-muted"}`}
              >
                {c.source === "client" ? "Named by client" : "Web search"}
              </span>
            </p>
            {c.oneLiner ? <p className="text-body-sm text-secondary">{c.oneLiner}</p> : null}
            <p className="text-body-sm text-body">
              <span className="text-muted">Funding: </span>
              {funding || "–"}
              {c.funding.totalRaised ? ` · ${c.funding.totalRaised} total` : ""}
              {c.hq ? <span className="text-muted"> · {c.hq}</span> : null}
            </p>
            {c.funding.investors.length ? (
              <p className="text-body-sm text-secondary">
                <span className="text-muted">Investors named: </span>
                {c.funding.investors.join(", ")}
              </p>
            ) : null}
            <LinkLine label="Website" url={c.website} state={c.links.website} />
            <LinkLine label="Funding news" url={c.newsUrl} state={c.links.news} title={c.newsTitle} />
            {c.why ? <p className="text-body-sm text-muted">{c.why}</p> : null}
          </div>
          {locked ? null : (
            <div className="flex flex-wrap gap-xs">
              <button type="button" className={smallButton} disabled={first} onClick={() => onMove(-1)} aria-label="Move up">
                ↑
              </button>
              <button type="button" className={smallButton} disabled={last} onClick={() => onMove(1)} aria-label="Move down">
                ↓
              </button>
              <button type="button" className={smallButton} onClick={onEdit}>
                Edit
              </button>
              <button type="button" className={smallButton} onClick={onRemove}>
                Remove
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** The details of one competitor, in a modal. Closes on the backdrop, the button or Escape. */
function DetailsModal({ c, rank, onClose }: { c: Competitor; rank: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const funding = [c.funding.lastRound, c.funding.lastRoundDate].filter(Boolean).join(", ");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-heading/40 p-md" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={c.name}
        className="animate-slide-in max-h-[85vh] w-full max-w-xl overflow-auto rounded-card border border-border bg-surface px-lg py-md shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-md">
          <h3 className="text-h3 text-heading">
            <span className="mr-sm text-muted">{rank}.</span>
            {c.name}
          </h3>
          <button type="button" className={smallButton} onClick={onClose}>
            Close
          </button>
        </div>
        {c.oneLiner ? <p className="mt-xs text-body-sm text-secondary">{c.oneLiner}</p> : null}
        <dl className="mt-md grid grid-cols-[140px_1fr] gap-x-md gap-y-xs text-body-sm">
          <dt className="text-muted">Stage</dt>
          <dd className="text-heading">{c.stage || "–"}</dd>
          <dt className="text-muted">Geography</dt>
          <dd className="text-heading">{c.geography || "–"}</dd>
          <dt className="text-muted">Primary sector</dt>
          <dd className="text-heading">{c.primarySector || "–"}</dd>
          <dt className="text-muted">Latest round</dt>
          <dd className="text-body">{funding || "–"}</dd>
          <dt className="text-muted">Total raised</dt>
          <dd className="text-body">{c.funding.totalRaised || "–"}</dd>
          <dt className="text-muted">HQ</dt>
          <dd className="text-body">{c.hq || "–"}</dd>
          <dt className="text-muted">Investors named</dt>
          <dd className="text-body">{c.funding.investors.length ? c.funding.investors.join(", ") : "–"}</dd>
          <dt className="text-muted">Source</dt>
          <dd className="text-body">{c.source === "client" ? "Named by the client" : "Web search"}</dd>
        </dl>
        <div className="mt-md space-y-xs">
          <LinkLine label="Website" url={c.website} state={c.links.website} />
          <LinkLine label="Funding news" url={c.newsUrl} state={c.links.news} title={c.newsTitle} />
        </div>
        {c.why ? <p className="mt-md text-body-sm text-muted">{c.why}</p> : null}
      </div>
    </div>
  );
}

/** The confirmed list, summarized like Step 1: one row per competitor; click a row for the details. */
function ConfirmedSummary({
  landscape,
  items,
  busy,
  onStartOver,
}: {
  landscape: Landscape;
  items: Competitor[];
  busy: boolean;
  onStartOver: () => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const close = useCallback(() => setOpen(null), []);
  return (
    <Card tone="final">
      <div className="flex flex-wrap items-end justify-between gap-md">
        <div>
          <BigNumber value={items.length} label="Funded competitors: confirmed" />
          <p className="text-body-sm text-secondary">
            Confirmed {when(landscape.confirmedAt)}
            {landscape.confirmedBy ? ` by ${landscape.confirmedBy}` : ""}.
          </p>
        </div>
        <button type="button" className={secondaryButton} disabled={busy} onClick={onStartOver}>
          {busy ? "Starting over…" : "Start over"}
        </button>
      </div>
      <table className="mt-md w-full text-left text-body-sm">
        <thead className="text-label uppercase tracking-label text-muted">
          <tr>
            <th className="py-xs pr-md font-medium">#</th>
            <th className="py-xs pr-md font-medium">Competitor</th>
            <th className="py-xs pr-md font-medium">Stage</th>
            <th className="py-xs pr-md font-medium">Geography</th>
            <th className="py-xs font-medium">Primary sector</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c, i) => (
            <tr
              key={c.id}
              tabIndex={0}
              className="cursor-pointer border-t border-border hover:bg-surface/70 focus:bg-surface/70 focus:outline-none"
              onClick={() => setOpen(i)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setOpen(i);
                }
              }}
            >
              <td className="py-xs pr-md text-muted">{i + 1}</td>
              <td className="py-xs pr-md text-heading underline decoration-border underline-offset-4">{c.name}</td>
              <td className="py-xs pr-md text-secondary">{c.stage || "–"}</td>
              <td className="py-xs pr-md text-secondary">{c.geography || "–"}</td>
              <td className="py-xs text-secondary">{c.primarySector || "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-md text-body-sm text-muted">Click a competitor for its funding, investors and links.</p>
      {open !== null && items[open] ? <DetailsModal c={items[open]} rank={open + 1} onClose={close} /> : null}
    </Card>
  );
}

/**
 * Step 2A: the top funded direct competitors, most relevant first. Opens
 * once Step 1 is confirmed. Show Competitors searches the web; the admin
 * checks the links, edits, removes, adds, reorders, and confirms.
 */
export function CompetitiveLandscape({ clientId, stepOneConfirmed }: { clientId: string; stepOneConfirmed: boolean }) {
  const [landscape, setLandscape] = useState<Landscape | null>(null);
  const [items, setItems] = useState<Competitor[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let live = true;
    setLoaded(false);
    void loadLandscape(clientId).then((result) => {
      if (!live) return;
      setLoaded(true);
      if (!result.ok) return setError(result.error);
      setLandscape(result.landscape);
      setItems(result.landscape?.competitors ?? []);
      setDirty(false);
    });
    return () => {
      live = false;
    };
  }, [clientId, stepOneConfirmed]);

  const take = (next: Landscape) => {
    setLandscape(next);
    setItems(next.competitors);
    setDirty(false);
    setEditing(null);
  };

  const run = async (label: string, action: () => Promise<{ ok: true; landscape: Landscape } | { ok: false; error: string }>) => {
    setBusy(label);
    setError(null);
    const result = await action();
    setBusy(null);
    if (!result.ok) return setError(result.error);
    take(result.landscape);
  };

  const edit = (next: Competitor[]) => {
    setItems(next);
    setDirty(true);
  };

  if (!stepOneConfirmed) {
    return <p className="rounded-card border border-border bg-surface px-lg py-md text-body-sm text-muted">Opens once Step 1 is confirmed.</p>;
  }
  if (!loaded) return <p className="text-body-sm text-muted">Loading…</p>;

  const locked = landscape?.status === "confirmed";
  const startOver = async () => {
    if (!window.confirm("Start over? This list is set aside (kept on record) and you can search again.")) return;
    setBusy("start");
    setError(null);
    const result = await startOverLandscape(clientId);
    setBusy(null);
    if (!result.ok) return setError(result.error);
    setLandscape(null);
    setItems([]);
    setDirty(false);
  };

  if (landscape && locked) {
    return (
      <div className="space-y-sm">
        <ConfirmedSummary landscape={landscape} items={items} busy={busy === "start"} onStartOver={() => void startOver()} />
        {error ? <p className="text-body-sm text-error">{error}</p> : null}
      </div>
    );
  }

  return (
    <section className="animate-slide-in space-y-md rounded-card border border-border bg-surface px-lg py-md">
      <p className="text-body-sm text-secondary">
        Top {MAX_COMPETITORS} <strong className="font-medium text-heading">funded</strong> direct competitors, most relevant first. Check each
        website and funding article, then confirm.
      </p>

      {!landscape ? (
        <button type="button" className={primaryButton} disabled={busy !== null} onClick={() => void run("find", () => showCompetitors(clientId))}>
          {busy === "find" ? "Searching the web… this can take 2–3 minutes" : "Show Competitors"}
        </button>
      ) : (
        <>
          <p className="text-body-sm text-muted">
            {locked
              ? `Confirmed ${when(landscape.confirmedAt)}${landscape.confirmedBy ? ` by ${landscape.confirmedBy}` : ""}.`
              : `Searched ${when(landscape.searchedAt)}. Draft: edit, then confirm.`}{" "}
            Named by the client in the intake: {landscape.clientNamed.length ? landscape.clientNamed.join(", ") : "none"}.
            {landscape.unfundedNamed.length ? ` Named by the client but no funding found (left out): ${landscape.unfundedNamed.join(", ")}.` : ""}
          </p>
          {items.length === 0 ? <p className="text-body-sm text-warning">No funded direct competitors found.</p> : null}
          <ol className="space-y-sm">
            {items.map((c, i) => (
              <Row
                key={c.id}
                c={c}
                rank={i + 1}
                locked={locked}
                editing={editing === c.id}
                first={i === 0}
                last={i === items.length - 1}
                onEdit={() => setEditing(c.id)}
                onCancel={() => {
                  setEditing(null);
                  if (!c.name) edit(items.filter((x) => x.id !== c.id));
                }}
                onSave={(next) => {
                  edit(items.map((x) => (x.id === c.id ? next : x)));
                  setEditing(null);
                }}
                onRemove={() => edit(items.filter((x) => x.id !== c.id))}
                onMove={(dir) => {
                  const next = [...items];
                  [next[i], next[i + dir]] = [next[i + dir], next[i]];
                  edit(next);
                }}
              />
            ))}
          </ol>
          <div className="flex flex-wrap gap-sm">
            {locked ? null : (
              <>
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={busy !== null || items.length >= MAX_COMPETITORS || editing !== null}
                  onClick={() => {
                    const c = blank();
                    setItems([...items, c]);
                    setEditing(c.id);
                  }}
                >
                  Add competitor
                </button>
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={busy !== null || !dirty || editing !== null}
                  onClick={() => void run("save", () => saveLandscape(clientId, items, false))}
                >
                  {busy === "save" ? "Saving and checking links…" : "Save changes"}
                </button>
                <button
                  type="button"
                  className={primaryButton}
                  disabled={busy !== null || editing !== null || items.length === 0}
                  onClick={() => void run("confirm", () => saveLandscape(clientId, items, true))}
                >
                  {busy === "confirm" ? "Confirming…" : "Confirm list"}
                </button>
              </>
            )}
            <button type="button" className={secondaryButton} disabled={busy !== null} onClick={() => void startOver()}>
              {busy === "start" ? "Starting over…" : "Start over"}
            </button>
          </div>
          {!locked ? <p className="text-body-sm text-muted">Edits are kept once you save or confirm; every link is opened again when you do.</p> : null}
        </>
      )}
      {error ? <p className="text-body-sm text-error">{error}</p> : null}
    </section>
  );
}
