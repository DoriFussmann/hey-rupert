"use client";

import { useCallback, useEffect, useState } from "react";
import { findInvestorsFor, saveInvestorList, startOverInvestors } from "@/app/admin/landscape-actions";
import { INVESTOR_KINDS, KIND_LABEL, type Investor, type InvestorKind } from "@/lib/match/landscape/investors";
import type { Landscape } from "@/lib/match/landscape/server";
import { inputClass, labelClass, primaryButton, secondaryButton, smallButton } from "@/app/admin/clients/[id]/match/ui";
import { BigNumber, Card } from "@/app/admin/matching/dry-match";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "");

const competitorsOf = (inv: Investor) => Array.from(new Set(inv.backed.map((b) => b.competitor)));
const isLead = (inv: Investor) => inv.backed.some((b) => b.lead);

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** One investor's details: every competitor it backed, the round, and the source. */
function InvestorModal({ inv, onClose }: { inv: Investor; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-heading/40 p-md" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={inv.name}
        className="animate-slide-in max-h-[85vh] w-full max-w-xl overflow-auto rounded-card border border-border bg-surface px-lg py-md shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-md">
          <h3 className="text-h3 text-heading">{inv.name}</h3>
          <button type="button" className={smallButton} onClick={onClose}>
            Close
          </button>
        </div>
        <p className="mt-xs text-body-sm text-secondary">
          {KIND_LABEL[inv.kind]}
          {inv.website ? (
            <>
              {" · "}
              <a href={inv.website} target="_blank" rel="noreferrer noopener" className="text-primary underline">
                {host(inv.website)}
              </a>
            </>
          ) : null}
        </p>
        <ul className="mt-md space-y-sm text-body-sm">
          {inv.backed.map((b, i) => (
            <li key={`${b.competitorId}-${i}`} className="rounded-md border border-border px-md py-sm">
              <p className="text-heading">
                {b.competitor}
                {b.lead ? <span className="ml-sm text-label uppercase tracking-label text-primary">Led</span> : null}
              </p>
              <p className="text-secondary">{b.round || "Round not stated"}</p>
              {b.sourceUrl ? (
                <a href={b.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-primary underline">
                  Source: {host(b.sourceUrl)}
                </a>
              ) : (
                <p className="text-muted">No source link</p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function InvestorTable({
  items,
  onOpen,
  onRemove,
  limit,
}: {
  items: Investor[];
  onOpen: (i: number) => void;
  onRemove?: (id: string) => void;
  /** Show only the first rows; a panel at the bottom opens the rest. */
  limit?: number;
}) {
  const [all, setAll] = useState(false);
  const shown = limit && !all ? items.slice(0, limit) : items;
  const hidden = items.length - shown.length;
  return (
    <>
    <table className="mt-md w-full text-left text-body-sm">
      <thead className="text-label uppercase tracking-label text-muted">
        <tr>
          <th className="py-xs pr-md font-medium">#</th>
          <th className="py-xs pr-md font-medium">Investor</th>
          <th className="py-xs pr-md font-medium">Kind</th>
          <th className="py-xs pr-md font-medium">Backed</th>
          {onRemove ? <th className="py-xs font-medium" /> : null}
        </tr>
      </thead>
      <tbody>
        {shown.map((inv, i) => (
          <tr
            key={inv.id}
            tabIndex={0}
            className="cursor-pointer border-t border-border align-top hover:bg-background focus:bg-background focus:outline-none"
            onClick={() => onOpen(i)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onOpen(i);
            }}
          >
            <td className="py-xs pr-md text-muted">{i + 1}</td>
            <td className="py-xs pr-md text-heading underline decoration-border underline-offset-4">
              {inv.name}
              {isLead(inv) ? <span className="ml-sm text-label uppercase tracking-label text-primary">Led a round</span> : null}
            </td>
            <td className="py-xs pr-md text-secondary">{KIND_LABEL[inv.kind]}</td>
            <td className="py-xs pr-md text-secondary">{competitorsOf(inv).join(", ")}</td>
            {onRemove ? (
              <td className="py-xs text-right">
                <button
                  type="button"
                  className={smallButton}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(inv.id);
                  }}
                >
                  Remove
                </button>
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
    {limit && items.length > limit ? (
      <button
        type="button"
        aria-expanded={all}
        onClick={() => setAll(!all)}
        className="mt-xs flex w-full items-center justify-center gap-sm rounded-md border border-border bg-surface/70 px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading"
      >
        {all ? "Show the top " + limit + " only" : `Show all ${items.length} (${hidden} more)`}
        <span className={`transition-transform duration-hover ${all ? "rotate-180" : ""}`}>▾</span>
      </button>
    ) : null}
    </>
  );
}

function AddInvestor({ competitors, onAdd, onCancel }: { competitors: { id: string; name: string }[]; onAdd: (inv: Investor) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [kind, setKind] = useState<InvestorKind>("fund");
  const [competitorId, setCompetitorId] = useState(competitors[0]?.id ?? "");
  const [round, setRound] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const field = (label: string, input: React.ReactNode) => (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <div className="mt-xs">{input}</div>
    </label>
  );
  return (
    <div className="mt-md grid gap-sm rounded-md border border-border bg-background p-md md:grid-cols-2">
      {field("Investor name", <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />)}
      {field("Website", <input className={inputClass} value={website} onChange={(e) => setWebsite(e.target.value)} />)}
      {field(
        "Kind",
        <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as InvestorKind)}>
          {INVESTOR_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>,
      )}
      {field(
        "Backed",
        <select className={inputClass} value={competitorId} onChange={(e) => setCompetitorId(e.target.value)}>
          {competitors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>,
      )}
      {field("Round", <input className={inputClass} value={round} onChange={(e) => setRound(e.target.value)} />)}
      {field("Source link", <input className={inputClass} value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />)}
      <div className="flex gap-sm md:col-span-2">
        <button
          type="button"
          className={primaryButton}
          disabled={!name.trim() || !competitorId}
          onClick={() =>
            onAdd({
              id: `new-${Math.random().toString(36).slice(2)}`,
              name: name.trim(),
              website,
              kind,
              source: "admin",
              backed: [{ competitorId, competitor: competitors.find((c) => c.id === competitorId)?.name ?? "", round, lead: false, sourceUrl }],
            })
          }
        >
          Add
        </button>
        <button type="button" className={secondaryButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Step 2B: every investor in the confirmed competitors. Find Investors
 * researches one competitor at a time (each call is short enough to finish),
 * merging the same investor across competitors. No cap on how many.
 */
export function InvestorsStep({ clientId, landscape, onChange }: { clientId: string; landscape: Landscape; onChange: (next: Landscape) => void }) {
  const [items, setItems] = useState<Investor[]>(landscape.investors);
  const [dirty, setDirty] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const close = useCallback(() => setOpen(null), []);

  useEffect(() => {
    if (!dirty) setItems(landscape.investors);
  }, [landscape.investors, dirty]);

  const competitors = landscape.competitors;
  const pending = competitors.filter((c) => landscape.research[c.id]?.status !== "done");
  const locked = landscape.investorsStatus === "confirmed";

  const research = async (ids: string[]) => {
    setError(null);
    let latest = landscape;
    for (const id of ids) {
      setRunning(id);
      const result = await findInvestorsFor(clientId, id);
      if (!result.ok) {
        setError(result.error);
        continue;
      }
      latest = result.landscape;
      onChange(latest);
    }
    setRunning(null);
  };

  const save = async (confirm: boolean) => {
    setBusy(confirm ? "confirm" : "save");
    setError(null);
    const result = await saveInvestorList(clientId, items, confirm);
    setBusy(null);
    if (!result.ok) return setError(result.error);
    setDirty(false);
    onChange(result.landscape);
  };

  const startOver = async () => {
    if (!window.confirm("Start over the investor list? The confirmed competitors stay.")) return;
    setBusy("start");
    setError(null);
    const result = await startOverInvestors(clientId);
    setBusy(null);
    if (!result.ok) return setError(result.error);
    setDirty(false);
    onChange(result.landscape);
  };

  const errorLine = error ? <p className="mt-sm text-body-sm text-error">{error}</p> : null;
  const modal = open !== null && items[open] ? <InvestorModal inv={items[open]} onClose={close} /> : null;

  if (locked) {
    return (
      <Card tone="final">
        <div className="flex items-start justify-between gap-md">
          <div className="min-w-0 flex-1">
            <BigNumber value={items.length} label="Step 2B · Investors in the competitors: confirmed" />
            <p className="text-body-sm text-secondary">
              Confirmed {when(landscape.investorsConfirmedAt)}
              {landscape.investorsConfirmedBy ? ` by ${landscape.investorsConfirmedBy}` : ""}.
            </p>
          </div>
          <button type="button" className={`${secondaryButton} shrink-0`} disabled={busy !== null} onClick={() => void startOver()}>
            {busy === "start" ? "Starting over…" : "Start over"}
          </button>
        </div>
        <InvestorTable items={items} onOpen={setOpen} limit={10} />
        <p className="mt-md text-body-sm text-muted">Most competitors backed first. Click an investor for the rounds and sources.</p>
        {errorLine}
        {modal}
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div>
          <h3 className="text-h4 text-heading">Step 2B: Investors in the competitors</h3>
          <p className="text-body-sm text-muted">Researched one competitor at a time. No cap.</p>
        </div>
        {landscape.investorsStatus !== "none" ? (
          <button type="button" className={`${secondaryButton} shrink-0`} disabled={running !== null || busy !== null} onClick={() => void startOver()}>
            {busy === "start" ? "Starting over…" : "Start over"}
          </button>
        ) : null}
      </div>

      {landscape.investorsStatus === "none" && running === null ? (
        <button type="button" className={`${primaryButton} mt-sm`} onClick={() => void research(competitors.map((c) => c.id))}>
          Find Investors
        </button>
      ) : (
        <>
          <ul className="mt-sm grid gap-xs text-body-sm md:grid-cols-2">
            {competitors.map((c) => {
              const state = landscape.research[c.id];
              const now = running === c.id;
              return (
                <li key={c.id} className="flex items-center justify-between gap-sm rounded-md border border-border px-sm py-xs">
                  <span className="text-heading">{c.name}</span>
                  <span className={now ? "text-primary" : state?.status === "done" ? "text-success" : state?.status === "failed" ? "text-error" : "text-muted"}>
                    {now ? "Researching…" : state?.status === "done" ? `✓ ${state.found} found` : state?.status === "failed" ? "✗ failed" : "Waiting"}
                  </span>
                </li>
              );
            })}
          </ul>
          {running === null && pending.length > 0 ? (
            <button type="button" className={`${secondaryButton} mt-sm`} onClick={() => void research(pending.map((c) => c.id))}>
              Research the {pending.length} remaining
            </button>
          ) : null}
          {items.length ? (
            <>
              <p className="mt-md text-body-sm text-secondary">
                {items.length} investors so far, most competitors backed first. Click one for its rounds and sources.
              </p>
              <InvestorTable
                items={items}
                onOpen={setOpen}
                onRemove={(id) => {
                  setItems(items.filter((x) => x.id !== id));
                  setDirty(true);
                }}
              />
            </>
          ) : null}
          {adding ? (
            <AddInvestor
              competitors={competitors.map((c) => ({ id: c.id, name: c.name }))}
              onCancel={() => setAdding(false)}
              onAdd={(inv) => {
                setItems([...items, inv]);
                setDirty(true);
                setAdding(false);
              }}
            />
          ) : null}
          <div className="mt-md flex flex-wrap gap-sm">
            <button type="button" className={secondaryButton} disabled={running !== null || adding} onClick={() => setAdding(true)}>
              Add investor
            </button>
            <button type="button" className={secondaryButton} disabled={running !== null || busy !== null || !dirty} onClick={() => void save(false)}>
              {busy === "save" ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              className={primaryButton}
              disabled={running !== null || busy !== null || items.length === 0 || adding}
              onClick={() => void save(true)}
            >
              {busy === "confirm" ? "Confirming…" : "Confirm list"}
            </button>
          </div>
        </>
      )}
      {errorLine}
      {modal}
    </Card>
  );
}
