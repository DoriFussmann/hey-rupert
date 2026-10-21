"use client";

import { useState } from "react";
import { lookupFirms } from "@/app/admin/taxonomy-actions";
import { errorText, inputClass, labelClass, primaryButton } from "@/app/admin/clients/[id]/match/ui";
import type { FieldStatus, FirmLookupView } from "@/lib/taxonomy/core";

const STATUS_LABEL: Record<FieldStatus, string> = {
  missing: "No value",
  normalized: "Mapped",
  partial: "Partly mapped",
  unmapped: "Not mapped",
};

function FirmCard({ firm }: { firm: FirmLookupView }) {
  return (
    <li className="rounded-md border border-border bg-background p-md">
      <p className="text-heading">
        {firm.name} <span className="font-mono text-label text-muted">{firm.id}</span>
      </p>
      <p className="text-body-sm text-muted">
        {firm.website || "No website"}
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

export function FirmLookup() {
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ firms: FirmLookupView[]; more: boolean } | null>(null);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const found = await lookupFirms(query);
      if (!found.ok) setError(found.error);
      else setResult({ firms: found.firms, more: found.more });
    } catch (err) {
      setError(errorText(err, "The search failed."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-card border border-border bg-surface px-lg py-md">
      <form className="flex flex-wrap items-end gap-sm" onSubmit={search}>
        <div className="min-w-[16rem] flex-1">
          <label className={labelClass} htmlFor="firm-query">
            FirmID or firm name
          </label>
          <input
            id="firm-query"
            className={`${inputClass} mt-xs`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <button type="submit" className={primaryButton} disabled={pending || query.trim().length < 2}>
          {pending ? "Searching…" : "Look up"}
        </button>
      </form>
      {error ? (
        <p role="alert" className="mt-xs text-body-sm text-error">
          {error}
        </p>
      ) : null}
      {result ? (
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
    </div>
  );
}
