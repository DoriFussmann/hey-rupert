import { formatDateAtTime } from "@/lib/format";
import type { CoverageRun } from "@/lib/taxonomy/server";

function n(value: number) {
  return value.toLocaleString("en-US");
}

/** Never shows 100% or 0% unless it is exactly that. */
function pct(part: number, whole: number) {
  if (whole <= 0) return "–";
  if (part === whole) return "100%";
  if (part === 0) return "0%";
  const value = Math.min(99, Math.max(1, Math.round((part / whole) * 100)));
  return `${value}%`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border bg-background px-md py-sm">
      <p className="text-label uppercase tracking-label text-muted">{label}</p>
      <p className="mt-xs font-mono text-body text-heading">{value}</p>
      {hint ? <p className="text-body-sm text-muted">{hint}</p> : null}
    </div>
  );
}

/** The stored coverage and data-quality report for the live database. */
export function CoveragePanel({ run }: { run: CoverageRun }) {
  const report = run.report;
  return (
    <section aria-labelledby="coverage" className="mb-lg rounded-card border border-border bg-surface">
      <div className="border-b border-border px-lg py-md">
        <h2 id="coverage" className="text-h4 text-heading">
          Coverage and data quality
        </h2>
        <p className="mt-xs text-body-sm text-muted">
          {n(report.firms)} firms and {n(report.contacts)} contacts processed at taxonomy revision {run.revision},{" "}
          {formatDateAtTime(run.createdAt)}
          {run.createdBy ? ` by ${run.createdBy}` : ""}. Populated means the firm has a value; normalized means every
          value maps to a canonical category; approved means a person has confirmed those mappings.
        </p>
      </div>

      <div className="grid gap-sm px-lg py-md sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Firms with a sector" value={n(report.sector.populated)} hint={`${pct(report.sector.populated, report.firms)} of firms`} />
        <Stat label="Mapped to a canonical sector" value={n(report.sector.mapped)} hint={`${pct(report.sector.mapped, report.firms)} of firms`} />
        <Stat label="Two or more sectors" value={n(report.sector.multiCategory)} />
        <Stat label="Generalists" value={n(report.sector.generalist)} hint="Diversified, or 15+ industries" />
      </div>

      <div className="overflow-x-auto px-lg pb-md">
        <table className="w-full min-w-[760px] text-left text-body-sm">
          <thead>
            <tr className="border-b border-border text-label uppercase tracking-label text-muted">
              <th className="py-sm pr-md font-medium">Field</th>
              <th className="px-md py-sm text-right font-medium">Populated</th>
              <th className="px-md py-sm text-right font-medium">Normalized</th>
              <th className="px-md py-sm text-right font-medium">Approved</th>
              <th className="px-md py-sm text-right font-medium">Partly mapped</th>
              <th className="px-md py-sm text-right font-medium">Not mapped</th>
              <th className="py-sm pl-md text-right font-medium">Distinct values (mapped / open / ignored / to review)</th>
            </tr>
          </thead>
          <tbody>
            {report.fields.map((field) => (
              <tr key={field.field} className="border-b border-border">
                <td className="py-sm pr-md text-heading">{field.label}</td>
                <td className="px-md py-sm text-right font-mono">
                  {n(field.populated)} <span className="text-muted">{pct(field.populated, report.firms)}</span>
                </td>
                <td className="px-md py-sm text-right font-mono">
                  {n(field.normalized)} <span className="text-muted">{pct(field.normalized, field.populated)}</span>
                </td>
                <td className="px-md py-sm text-right font-mono">
                  {n(field.approved)} <span className="text-muted">{pct(field.approved, field.populated)}</span>
                </td>
                <td className="px-md py-sm text-right font-mono">{n(field.partial)}</td>
                <td className="px-md py-sm text-right font-mono">{n(field.unmapped)}</td>
                <td className="py-sm pl-md text-right font-mono">
                  {n(field.distinct)}{" "}
                  <span className="text-muted">
                    ({n(field.distinctMapped)} / {n(field.distinctUnmapped)} / {n(field.distinctIgnored)} /{" "}
                    {n(field.distinctNeedsReview)})
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-sm px-lg pb-md sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Firms needing review" value={n(report.reviewFirms)} hint="Unmapped, unreviewed or broken values" />
        <Stat label="Values to review" value={n(report.valuesTotal)} hint={`${n(report.aliases.proposals)} with an AI suggestion`} />
        <Stat
          label="Relationships to review"
          value={n(report.edges.needsReview)}
          hint={`${n(report.edges.approved)} approved, ${n(report.edges.rejected)} rejected`}
        />
        <Stat label="Conflicts" value={n(report.conflicts.length)} />
      </div>

      <div className="space-y-sm px-lg pb-lg text-body-sm">
        {report.conflicts.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-heading">Conflicts ({n(report.conflicts.length)})</summary>
            <ul className="mt-xs list-disc pl-lg text-secondary">
              {report.conflicts.map((conflict) => (
                <li key={`${conflict.field}-${conflict.rawValue}-${conflict.detail}`}>
                  {conflict.rawValue}: {conflict.detail}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <details>
          <summary className="cursor-pointer text-heading">
            Possible duplicate firms: {n(report.duplicates.sameNameCount)} names and {n(report.duplicates.sameWebsiteCount)}{" "}
            websites used by more than one FirmID
          </summary>
          <p className="mt-xs text-muted">
            Flagged only. Nothing is merged: the same name can be different funds, and FirmID stays the identity.
          </p>
          <div className="mt-sm grid gap-md md:grid-cols-2">
            {[
              { title: "Same name", groups: report.duplicates.sameName, total: report.duplicates.sameNameCount },
              { title: "Same website", groups: report.duplicates.sameWebsite, total: report.duplicates.sameWebsiteCount },
            ].map((block) => (
              <div key={block.title}>
                <p className="text-label uppercase tracking-label text-muted">{block.title}</p>
                {block.groups.length === 0 ? (
                  <p className="text-muted">None.</p>
                ) : (
                  <ul className="mt-xs space-y-xs text-secondary">
                    {block.groups.map((group) => (
                      <li key={group.key}>
                        <span className="text-heading">{group.key}</span>:{" "}
                        {group.firms.map((firm) => `${firm.name} (${firm.id})`).join(", ")}
                      </li>
                    ))}
                    {block.total > block.groups.length ? (
                      <li className="text-muted">…and {n(block.total - block.groups.length)} more</li>
                    ) : null}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </details>
        <p className="text-secondary">
          Also: {n(report.suspicious.noContacts)} firms with no contacts and {n(report.suspicious.noWebsite)} with no
          website.
        </p>
        {report.reviewSample.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-heading">
              Firms needing review (first {n(report.reviewSample.length)} of {n(report.reviewFirms)})
            </summary>
            <ul className="mt-xs grid gap-xs text-secondary sm:grid-cols-2">
              {report.reviewSample.map((firm) => (
                <li key={firm.id}>
                  {firm.name} <span className="font-mono text-muted">{firm.id}</span> · {firm.issues} issue
                  {firm.issues === 1 ? "" : "s"}
                </li>
              ))}
            </ul>
            <p className="mt-xs text-muted">Most firm issues clear when the values they use are mapped. Use Firm lookup for details.</p>
          </details>
        ) : null}
      </div>
    </section>
  );
}
