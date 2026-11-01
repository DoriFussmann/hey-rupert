"use client";

import { Fragment, useEffect, useState } from "react";
import { editAdded, loadAddedFunds, reviewAdded, type AddedView } from "@/app/admin/added-funds-actions";
import type { AddedStatus } from "@/lib/match/added/core";
import type { LabelLists } from "@/lib/match/added/server";
import { inputClass, labelClass, primaryButton, secondaryButton, smallButton } from "@/app/admin/clients/[id]/match/ui";

const n = (v: number) => v.toLocaleString("en-US");
const STATUS_LABEL: Record<AddedStatus, string> = { pending: "Pending review", approved: "Approved", rejected: "Rejected" };
const STATUS_TONE: Record<AddedStatus, string> = { pending: "text-warning", approved: "text-success", rejected: "text-muted" };

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Ext({ url, label }: { url: string; label?: string }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" className="text-primary underline decoration-primary/40 underline-offset-2">
      {label ?? host(url)} ↗
    </a>
  );
}

type ListKey = "stages" | "geographies" | "industries" | "verticals" | "financing";
const LIST_FIELDS: { key: ListKey; label: string; options: keyof LabelLists }[] = [
  { key: "stages", label: "Stages", options: "stages" },
  { key: "geographies", label: "Geographies", options: "geographies" },
  { key: "industries", label: "Industries", options: "industries" },
  { key: "verticals", label: "Verticals", options: "verticals" },
  { key: "financing", label: "Financing (empty = Equity)", options: "financing" },
];

/** Edit a pending fund. Lists are comma separated; only the taxonomy's labels are kept (the suggestions show them). */
function EditFund({ fund, labels, onSaved, onCancel }: { fund: AddedView; labels: LabelLists; onSaved: (f: AddedView) => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    name: fund.name,
    website: fund.website,
    description: fund.description,
    hqCity: fund.hqCity,
    hqCountry: fund.hqCountry,
    firmType: fund.firmType,
    stages: fund.stages.join(", "),
    geographies: fund.geographies.join(", "),
    industries: fund.industries.join(", "),
    verticals: fund.verticals.join(", "),
    financing: fund.financing.join(", "),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const split = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);
  const text = (key: keyof typeof form, label: string, list?: string) => (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input className={`${inputClass} mt-xs`} list={list} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </label>
  );
  return (
    <div className="grid gap-sm md:grid-cols-2">
      {text("name", "Name")}
      {text("website", "Website")}
      {text("hqCity", "HQ city")}
      {text("hqCountry", "HQ country", "added-geographies")}
      {text("firmType", "Firm type", "added-firmTypes")}
      {text("description", "What it invests in")}
      {LIST_FIELDS.map((f) => (
        <label key={f.key} className="block md:col-span-2">
          <span className={labelClass}>{f.label}</span>
          <input className={`${inputClass} mt-xs`} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
          <span className="mt-xs block text-body-sm text-muted">Allowed: {labels[f.options].slice(0, 40).join(", ")}{labels[f.options].length > 40 ? "…" : ""}</span>
        </label>
      ))}
      <datalist id="added-geographies">
        {labels.geographies.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
      <datalist id="added-firmTypes">
        {labels.firmTypes.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-center gap-sm md:col-span-2">
        <button
          type="button"
          className={primaryButton}
          disabled={busy || !form.name.trim()}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const result = await editAdded(fund.id, {
              name: form.name,
              website: form.website,
              description: form.description,
              hqCity: form.hqCity,
              hqCountry: form.hqCountry,
              firmType: form.firmType,
              stages: split(form.stages),
              geographies: split(form.geographies),
              industries: split(form.industries),
              verticals: split(form.verticals),
              financing: split(form.financing),
            });
            setBusy(false);
            if (!result.ok) return setError(result.error);
            onSaved({ ...result.fund, clientName: fund.clientName });
          }}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className={secondaryButton} onClick={onCancel}>
          Cancel
        </button>
        {error ? <span className="text-body-sm text-error">{error}</span> : null}
      </div>
    </div>
  );
}

function Details({ fund, labels, onChange }: { fund: AddedView; labels: LabelLists; onChange: (f: AddedView) => void }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(fund.reviewNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const review = async (status: AddedStatus) => {
    if (status === "approved" && !window.confirm(`Approve ${fund.name}? It joins the shared Fund Database and can match every client.`)) return;
    setBusy(true);
    setError(null);
    const result = await reviewAdded(fund.id, status, note);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    onChange({ ...result.fund, clientName: fund.clientName });
  };
  if (editing) return <EditFund fund={fund} labels={labels} onCancel={() => setEditing(false)} onSaved={(f) => (setEditing(false), onChange(f))} />;
  const row = (label: string, value: React.ReactNode) => (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-body">{value || <span className="text-warning">not found</span>}</dd>
    </>
  );
  return (
    <div className="space-y-md">
      <dl className="grid grid-cols-[150px_1fr] gap-x-md gap-y-xs text-body-sm">
        {row("Website", fund.website ? <Ext url={fund.website} /> : null)}
        {row("What it invests in", fund.description)}
        {row("HQ", [fund.hqCity, fund.hqCountry].filter(Boolean).join(", "))}
        {row("Founded", fund.foundedYear ? String(fund.foundedYear) : "")}
        {row("Firm type", fund.firmType)}
        {row("Stages", fund.stages.join(", "))}
        {row("Geographies", fund.geographies.join(", "))}
        {row("Industries", fund.industries.join(", "))}
        {row("Verticals", fund.verticals.join(", "))}
        {row("Financing", fund.financing.join(", ") || "Equity (default)")}
        {row("Database id", fund.firmId)}
      </dl>
      <div>
        <p className={labelClass}>Contacts (Hunter)</p>
        {fund.contacts.length ? (
          <table className="mt-xs w-full text-left text-body-sm">
            <tbody>
              {fund.contacts.map((c) => (
                <tr key={c.email || `${c.first}${c.last}`} className="border-t border-border">
                  <td className="py-xs pr-md text-heading">{[c.first, c.last].filter(Boolean).join(" ") || "–"}</td>
                  <td className="py-xs pr-md text-secondary">{c.title || "–"}</td>
                  <td className="py-xs pr-md text-secondary">{c.email || "–"}</td>
                  <td className="py-xs pr-md text-muted">{c.confidence != null ? `${c.confidence}%` : ""}</td>
                  <td className="py-xs text-muted">{c.linkedin ? <Ext url={c.linkedin} label="LinkedIn" /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-xs text-body-sm text-warning">No contacts found.</p>
        )}
      </div>
      {fund.sources.length ? (
        <p className="flex flex-wrap gap-x-md gap-y-xs text-body-sm">
          <span className="text-muted">Sources:</span>
          {fund.sources.map((s) => (
            <Ext key={s.url} url={s.url} label={s.label || host(s.url)} />
          ))}
        </p>
      ) : null}
      {fund.notes ? <p className="text-body-sm text-secondary">Notes: {fund.notes}</p> : null}
      <div className="flex flex-wrap items-center gap-sm">
        {fund.status === "pending" ? (
          <>
            <button type="button" className={primaryButton} disabled={busy} onClick={() => void review("approved")}>
              Approve
            </button>
            <button type="button" className={secondaryButton} disabled={busy} onClick={() => setEditing(true)}>
              Edit
            </button>
            <button type="button" className={secondaryButton} disabled={busy} onClick={() => void review("rejected")}>
              Reject
            </button>
          </>
        ) : (
          <button type="button" className={secondaryButton} disabled={busy} onClick={() => void review("pending")}>
            Back to pending
          </button>
        )}
        <input className={`${inputClass} max-w-sm`} placeholder="Review note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {error ? <span className="text-body-sm text-error">{error}</span> : null}
      </div>
      {fund.reviewedAt ? (
        <p className="text-body-sm text-muted">
          {STATUS_LABEL[fund.status]} {new Date(fund.reviewedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
          {fund.reviewedBy ? ` by ${fund.reviewedBy}` : ""}.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Funds added by Rupert (Matching → Step 2 → Try and Add to DB). Pending ones
 * are used only for the client they were found for; approving one adds it to
 * the shared Fund Database for every client.
 */
export function AddedFundsReview() {
  const [funds, setFunds] = useState<AddedView[] | null>(null);
  const [labels, setLabels] = useState<LabelLists | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AddedStatus>("pending");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    void loadAddedFunds().then((result) => {
      if (!result.ok) return setError(result.error);
      setFunds(result.funds);
      setLabels(result.labels);
    });
  }, []);

  if (error) return <p className="text-body-sm text-error">{error}</p>;
  if (!funds || !labels) return <p className="text-body-sm text-muted">Loading…</p>;
  const count = (s: AddedStatus) => funds.filter((f) => f.status === s).length;
  const shown = funds.filter((f) => f.status === filter);
  const update = (f: AddedView) => setFunds(funds.map((x) => (x.id === f.id ? f : x)));

  return (
    <div className="space-y-md">
      <p className="text-body-sm text-secondary">
        Funds and angels Rupert added while researching a client&apos;s competitors. A pending one counts only for the client it was found for; approve it
        to add it to the shared database for every client. Check the details (in the taxonomy&apos;s labels) and the contacts first.
      </p>
      <div className="flex flex-wrap gap-xs">
        {(["pending", "approved", "rejected"] as AddedStatus[]).map((s) => (
          <button key={s} type="button" className={filter === s ? `${smallButton} !border-primary text-heading` : smallButton} onClick={() => setFilter(s)}>
            {STATUS_LABEL[s]} ({n(count(s))})
          </button>
        ))}
      </div>
      {shown.length ? (
        <table className="w-full text-left text-body-sm">
          <thead className="text-label uppercase tracking-label text-muted">
            <tr>
              <th className="py-xs pr-md font-medium">Fund</th>
              <th className="py-xs pr-md font-medium">Kind</th>
              <th className="py-xs pr-md font-medium">Found for</th>
              <th className="py-xs pr-md text-right font-medium">Contacts</th>
              <th className="py-xs font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((f) => (
              <Fragment key={f.id}>
                <tr className="cursor-pointer border-t border-border hover:bg-background" onClick={() => setOpen(open === f.id ? null : f.id)} aria-expanded={open === f.id}>
                  <td className="py-xs pr-md text-heading">
                    <span className={`mr-xs inline-block text-muted transition-transform duration-hover ${open === f.id ? "rotate-90" : ""}`}>›</span>
                    {f.name}
                  </td>
                  <td className="py-xs pr-md text-secondary">{f.kind === "angel" ? "Angel" : "Fund"}</td>
                  <td className="py-xs pr-md text-secondary">{f.clientName ?? "–"}</td>
                  <td className={`py-xs pr-md text-right ${f.contacts.length ? "text-heading" : "text-warning"}`}>{n(f.contacts.length)}</td>
                  <td className={`py-xs ${STATUS_TONE[f.status]}`}>{STATUS_LABEL[f.status]}</td>
                </tr>
                {open === f.id ? (
                  <tr className="bg-background">
                    <td colSpan={5} className="px-md py-md">
                      <Details fund={f} labels={labels} onChange={update} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-body-sm text-muted">None {filter === "pending" ? "waiting for review" : STATUS_LABEL[filter].toLowerCase()}.</p>
      )}
    </div>
  );
}
