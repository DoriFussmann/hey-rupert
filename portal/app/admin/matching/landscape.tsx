"use client";

import { Fragment, useEffect, useState } from "react";
import { loadLandscape, saveLandscape, showCompetitors, startOverLandscape } from "@/app/admin/landscape-actions";
import type { Competitor, LinkState } from "@/lib/match/landscape/core";
import { MAX_COMPETITORS } from "@/lib/match/landscape/core";
import type { Landscape } from "@/lib/match/landscape/server";
import { inputClass, labelClass, primaryButton, secondaryButton, smallButton } from "@/app/admin/clients/[id]/match/ui";

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
  const text = (key: "name" | "website" | "hq" | "newsUrl" | "newsTitle" | "oneLiner") => (
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

/** The confirmed list: one short row per competitor; click a row for the details. */
function ConfirmedTable({ items }: { items: Competitor[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const mark = (state: LinkState) => <span className={LINK_LOOK[state].tone}>{state === "live" ? "✓" : state === "broken" ? "✗" : "?"}</span>;
  return (
    <div className="overflow-hidden rounded-card border border-border">
      <table className="w-full text-left text-body-sm">
        <thead className="bg-background text-label uppercase tracking-label text-muted">
          <tr>
            <th className="px-sm py-xs font-medium">#</th>
            <th className="px-sm py-xs font-medium">Competitor</th>
            <th className="px-sm py-xs font-medium">Last round</th>
            <th className="px-sm py-xs font-medium">Total raised</th>
            <th className="px-sm py-xs font-medium">HQ</th>
            <th className="px-sm py-xs font-medium">Source</th>
            <th className="px-sm py-xs text-right font-medium">Links</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c, i) => {
            const expanded = open === c.id;
            return (
              <Fragment key={c.id}>
                <tr
                  className="cursor-pointer border-t border-border hover:bg-background"
                  onClick={() => setOpen(expanded ? null : c.id)}
                  aria-expanded={expanded}
                >
                  <td className="px-sm py-xs text-muted">{i + 1}</td>
                  <td className="px-sm py-xs text-heading">
                    <span className={`mr-xs inline-block text-muted transition-transform duration-hover ${expanded ? "rotate-90" : ""}`}>›</span>
                    {c.name}
                  </td>
                  <td className="px-sm py-xs text-secondary">{[c.funding.lastRound, c.funding.lastRoundDate].filter(Boolean).join(", ") || "–"}</td>
                  <td className="px-sm py-xs text-secondary">{c.funding.totalRaised || "–"}</td>
                  <td className="px-sm py-xs text-secondary">{c.hq || "–"}</td>
                  <td className="px-sm py-xs text-secondary">{c.source === "client" ? "Client" : "Web"}</td>
                  <td className="px-sm py-xs text-right" title="Website · funding news">
                    {mark(c.links.website)} · {mark(c.links.news)}
                  </td>
                </tr>
                {expanded ? (
                  <tr className="bg-background">
                    <td colSpan={7} className="px-md py-sm">
                      <div className="space-y-xs">
                        {c.oneLiner ? <p className="text-body-sm text-secondary">{c.oneLiner}</p> : null}
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
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
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

  return (
    <section className="animate-slide-in space-y-md rounded-card border border-border bg-surface px-lg py-md">
      <p className="text-body-sm text-secondary">
        Only the top {MAX_COMPETITORS} <strong className="font-medium text-heading">funded</strong> direct competitors are shown, most relevant
        first: named by the client, then closest product and customer, then geography, then stage. Check each website and funding article before
        confirming.
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
          {locked ? (
            <ConfirmedTable items={items} />
          ) : (
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
          )}
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
