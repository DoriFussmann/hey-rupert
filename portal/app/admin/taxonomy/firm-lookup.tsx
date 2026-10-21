"use client";

import { useEffect, useRef, useState } from "react";
import { lookupFirms } from "@/app/admin/taxonomy-actions";
import { errorText, inputClass, labelClass } from "@/app/admin/clients/[id]/match/ui";
import { Select } from "@/components/select";
import type { FieldStatus } from "@/lib/taxonomy/core";
import type { LookupFirm } from "@/lib/taxonomy/lookup";

export type FilterOption = { id: string; label: string };

const RELATION_LABEL: Record<string, string> = {
  equivalent: "Equivalent",
  immediate: "Immediate",
  broad: "Broader",
  weak: "Weak",
};

const STATUS_LABEL: Record<FieldStatus, string> = {
  missing: "No value",
  normalized: "Mapped",
  partial: "Partly mapped",
  unmapped: "Not mapped",
};

function FirmCard({ firm }: { firm: LookupFirm }) {
  return (
    <li className="rounded-md border border-border bg-background p-md">
      <p className="text-heading">
        {firm.name} <span className="font-mono text-label text-muted">{firm.id}</span>
      </p>
      <p className="text-body-sm text-muted">
        {firm.location || "No location"} · {firm.website || "No website"}
        {firm.generalistWhy ? ` · Generalist: ${firm.generalistWhy}` : ""}
      </p>
      <div className="mt-sm overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-body-sm">
          <thead>
            <tr className="border-b border-border text-label uppercase tracking-label text-muted">
              <th className="py-xs pr-md font-medium">Field</th>
              <th className="px-md py-xs font-medium">Provider value (unchanged)</th>
              <th className="px-md py-xs font-medium">Canonical</th>
              <th className="py-xs pl-md font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {firm.fields.map((field) => (
              <tr key={field.field} className="border-b border-border align-top">
                <td className="py-xs pr-md text-heading">{field.label}</td>
                <td className="px-md py-xs text-secondary">{field.raw.join("; ") || "–"}</td>
                <td className="px-md py-xs text-secondary">
                  {field.tags.length
                    ? field.tags.map((tag) => `${tag.label}${tag.review === "approved" ? "" : " (needs review)"}`).join(", ")
                    : "–"}
                </td>
                <td className="py-xs pl-md text-muted">{STATUS_LABEL[field.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {firm.relationships.length > 0 ? (
        <div className="mt-sm text-body-sm">
          <p className="text-label uppercase tracking-label text-muted">Sector links</p>
          <ul className="mt-xs grid gap-x-md sm:grid-cols-2">
            {firm.relationships.map((link) => (
              <li key={`${link.sector}-${link.other}-${link.relation}`} className="text-secondary">
                {link.sector} {link.directed ? "→" : "↔"} {link.other} <span className="text-muted">({RELATION_LABEL[link.relation] ?? link.relation})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {firm.issues.length > 0 ? (
        <ul className="mt-sm list-disc pl-lg text-body-sm text-warning">
          {firm.issues.map((issue, i) => (
            <li key={`${issue.field}-${issue.raw}-${i}`}>
              {issue.field}
              {issue.raw ? ` "${issue.raw}"` : ""}: {issue.kind}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Firm lookup: results appear as you type a name or FirmID, and the filters
 * narrow them by classified sector, geography and stage.
 */
export function FirmLookup({ sectors, geographies, stages }: { sectors: FilterOption[]; geographies: FilterOption[]; stages: FilterOption[] }) {
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("");
  const [geography, setGeography] = useState("");
  const [stage, setStage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ firms: LookupFirm[]; more: boolean } | null>(null);
  const latest = useRef(0);
  const active = query.trim().length >= 2 || Boolean(sector || geography || stage);

  useEffect(() => {
    if (!active) {
      setResult(null);
      setError(null);
      return;
    }
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      setPending(true);
      setError(null);
      try {
        const found = await lookupFirms({ query, sector: sector || null, geography: geography || null, stage: stage || null });
        if (ticket !== latest.current) return;
        if (!found.ok) setError(found.error);
        else setResult({ firms: found.firms, more: found.more });
      } catch (err) {
        if (ticket === latest.current) setError(errorText(err, "The search failed."));
      } finally {
        if (ticket === latest.current) setPending(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, sector, geography, stage, active]);

  const filter = (label: string, value: string, set: (value: string) => void, options: FilterOption[]) => (
    <label className={`${labelClass} min-w-[12rem]`}>
      {label}
      <Select value={value} onChange={(event) => set(event.target.value)} className="normal-case tracking-normal">
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>
    </label>
  );

  return (
    <section aria-labelledby="firm-lookup-title" className="mb-lg rounded-card border border-border bg-surface px-lg py-md">
      <h2 id="firm-lookup-title" className="text-h4 text-heading">
        Firm lookup
      </h2>
      <div className="mt-sm grid gap-sm md:grid-cols-[2fr_1fr_1fr_1fr]">
        <label className={labelClass} htmlFor="firm-query">
          Name or FirmID
          <input
            id="firm-query"
            className={`${inputClass} mt-xs normal-case tracking-normal`}
            value={query}
            placeholder="Start typing…"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {filter("Sector", sector, setSector, sectors)}
        {filter("Geography", geography, setGeography, geographies)}
        {filter("Stage", stage, setStage, stages)}
      </div>
      <p className="mt-xs text-body-sm text-muted" aria-live="polite">
        {pending ? "Searching…" : active ? "" : "Filters use the approved categories; a region includes the countries inside it."}
      </p>
      {error ? (
        <p role="alert" className="mt-xs text-body-sm text-error">
          {error}
        </p>
      ) : null}
      {result && active ? (
        result.firms.length === 0 ? (
          <p className="mt-md text-body-sm text-muted">No firm matches.</p>
        ) : (
          <>
            <ul className="mt-md space-y-sm">
              {result.firms.map((firm) => (
                <FirmCard key={firm.id} firm={firm} />
              ))}
            </ul>
            {result.more ? <p className="mt-sm text-body-sm text-muted">Showing the first 20. Narrow the search.</p> : null}
          </>
        )
      ) : null}
    </section>
  );
}
