"use client";

import { useMemo, useState } from "react";
import { proposeFof, reviewFof } from "@/app/admin/tiers-actions";
import { inputClass, labelClass, n, primaryButton, smallButton } from "@/app/admin/clients/[id]/match/ui";
import { ErrorLine, useAction } from "@/app/admin/taxonomy/use-action";

export type FofItem = {
  id: string;
  name: string;
  website: string;
  location: string;
  financing: string[];
  type: string;
  stages: string[];
  alsoDirect: boolean;
  exception: {
    status: "needs_review" | "approved" | "rejected";
    evidenceUrl: string;
    evidenceNote: string;
    rationale: string;
    proposedBy: string | null;
    proposedAt: string;
    reviewedBy: string | null;
    reviewedAt: string | null;
  } | null;
};

const STATUS_TEXT = { needs_review: "Awaiting review", approved: "Approved", rejected: "Rejected" } as const;
type Filter = "all" | "exceptions" | "review" | "direct";

function ExceptionForm({ item, onDone }: { item: FofItem; onDone: () => void }) {
  const { pending, error, run } = useAction();
  const [url, setUrl] = useState(item.exception?.evidenceUrl ?? "");
  const [note, setNote] = useState(item.exception?.evidenceNote ?? "");
  const [rationale, setRationale] = useState(item.exception?.rationale ?? "");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const done = await run(() =>
      proposeFof({ firmId: item.id, firmName: item.name, evidenceUrl: url, evidenceNote: note, rationale }),
    );
    if (done) onDone();
  }

  const id = `fof-${item.id}`;
  return (
    <form className="mt-sm space-y-sm" onSubmit={save}>
      <div>
        <label className={labelClass} htmlFor={`${id}-url`}>Evidence link (optional)</label>
        <input id={`${id}-url`} className={`${inputClass} mt-xs`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
      </div>
      <div>
        <label className={labelClass} htmlFor={`${id}-note`}>Evidence of direct investment</label>
        <textarea id={`${id}-note`} className={`${inputClass} mt-xs`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} required minLength={10} />
      </div>
      <div>
        <label className={labelClass} htmlFor={`${id}-why`}>Why it justifies an exception</label>
        <textarea id={`${id}-why`} className={`${inputClass} mt-xs`} rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} required minLength={20} />
      </div>
      <button type="submit" className={primaryButton} disabled={pending}>
        {pending ? "Saving…" : item.exception ? "Save and send for review again" : "Propose exception"}
      </button>
      <ErrorLine error={error} />
    </form>
  );
}

function Row({ item }: { item: FofItem }) {
  const [open, setOpen] = useState(false);
  const { pending, error, run } = useAction();
  const ex = item.exception;
  return (
    <li className="border-b border-border py-sm">
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="min-w-0">
          <p className="text-heading">
            {item.name} <span className="font-mono text-label text-muted">{item.id}</span>
          </p>
          <p className="text-body-sm text-muted">
            {[item.type, item.location, item.website].filter(Boolean).join(" · ")}
          </p>
          <p className="text-body-sm text-secondary">
            Financing: {item.financing.join("; ") || "–"}
            {item.alsoDirect ? <span className="text-muted"> (also lists a direct financing type)</span> : null}
          </p>
          {ex ? (
            <div className="mt-xs text-body-sm">
              <p className={ex.status === "approved" ? "text-success" : ex.status === "rejected" ? "text-error" : "text-warning"}>
                Exception: {STATUS_TEXT[ex.status]}
                {ex.reviewedBy ? ` by ${ex.reviewedBy}` : ex.proposedBy ? `, proposed by ${ex.proposedBy}` : ""}
              </p>
              <p className="text-secondary">Evidence: {ex.evidenceNote}</p>
              {ex.evidenceUrl ? (
                <p>
                  <a href={ex.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-secondary underline hover:text-heading">
                    {ex.evidenceUrl}
                  </a>
                </p>
              ) : null}
              <p className="text-secondary">Rationale: {ex.rationale}</p>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-xs">
          {ex?.status === "needs_review" ? (
            <>
              <button type="button" className={smallButton} disabled={pending} onClick={() => run(() => reviewFof(item.id, "approved"))}>
                Approve
              </button>
              <button type="button" className={smallButton} disabled={pending} onClick={() => run(() => reviewFof(item.id, "rejected"))}>
                Reject
              </button>
            </>
          ) : null}
          <button type="button" className={smallButton} aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Close" : ex ? "Edit evidence" : "Add exception"}
          </button>
        </div>
      </div>
      <ErrorLine error={error} />
      {open ? <ExceptionForm item={item} onDone={() => setOpen(false)} /> : null}
    </li>
  );
}

export function FofPanel({ items }: { items: FofItem[] }) {
  const [filter, setFilter] = useState<Filter>("exceptions");
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === "exceptions" && !item.exception) return false;
      if (filter === "review" && item.exception?.status !== "needs_review") return false;
      if (filter === "direct" && !item.alsoDirect) return false;
      return !q || item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q);
    });
  }, [items, filter, query]);
  const withExceptions = items.filter((i) => i.exception).length;

  return (
    <div>
      <p className="text-body-sm text-muted">
        {n(items.length)} funds list &quot;Fund of funds&quot; as financing. They are left out of the four tiers unless an
        exception with evidence of direct investment is approved. Their classification is never changed.
      </p>
      <div className="mt-sm flex flex-wrap items-end gap-sm">
        <div>
          <label className={labelClass} htmlFor="fof-filter">Show</label>
          <select id="fof-filter" className={`${inputClass} mt-xs`} value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="exceptions">With an exception ({n(withExceptions)})</option>
            <option value="review">Awaiting review</option>
            <option value="direct">Also list a direct financing type</option>
            <option value="all">All funds of funds</option>
          </select>
        </div>
        <div className="min-w-[14rem] flex-1">
          <label className={labelClass} htmlFor="fof-search">Fund name or FirmID</label>
          <input id="fof-search" className={`${inputClass} mt-xs`} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="mt-md text-body-sm text-muted">No funds match.</p>
      ) : (
        <ul className="mt-sm">
          {shown.slice(0, 100).map((item, i) => (
            <Row key={`${item.id}-${i}`} item={item} />
          ))}
        </ul>
      )}
      {shown.length > 100 ? <p className="mt-xs text-body-sm text-muted">Showing 100 of {n(shown.length)}. Narrow the search.</p> : null}
    </div>
  );
}
