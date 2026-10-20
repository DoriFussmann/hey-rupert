import { formatDate } from "@/lib/format";
import type { FundDbVersion } from "@/lib/match/shared";

function n(value: number) {
  return value.toLocaleString("en-US");
}

function signed(value: number) {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${n(Math.abs(value))}`;
}

function typeOf(version: FundDbVersion, first: boolean) {
  if (first) return "Original workbook";
  return version.source === "csv" ? "CSV import" : "Workbook update";
}

/**
 * Every version that went live, oldest first, with what each changed and the
 * running totals, then where the database stands now.
 */
export function DatabaseHistory({
  versions,
  live,
  verification,
}: {
  /** Versions that went live, oldest first. */
  versions: FundDbVersion[];
  live: FundDbVersion | null;
  /** Fixes and flags from Email Verification, applied on top for every client. */
  verification: { leftFirm: number; removed: number; corrected: number };
}) {
  if (versions.length === 0) return null;
  const original = versions[0];

  return (
    <section aria-labelledby="database-history" className="mt-lg overflow-x-auto rounded-card border border-border bg-surface">
      <div className="border-b border-border px-lg py-md">
        <h2 id="database-history" className="text-h4 text-heading">
          Database history
        </h2>
        <p className="mt-xs text-body-sm text-muted">Where the database started, everything added since, and where it is now.</p>
      </div>
      <table className="w-full min-w-[720px] text-left text-body-sm">
        <thead>
          <tr className="border-b border-border text-label uppercase tracking-label text-muted">
            <th className="px-lg py-sm font-medium">Date</th>
            <th className="px-md py-sm font-medium">Type</th>
            <th className="px-md py-sm font-medium">File</th>
            <th className="px-md py-sm text-right font-medium">Funds</th>
            <th className="px-md py-sm text-right font-medium">Contacts</th>
            <th className="px-md py-sm text-right font-medium">Total funds</th>
            <th className="px-lg py-sm text-right font-medium">Total contacts</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((version, index) => {
            const previous = index > 0 ? versions[index - 1] : null;
            return (
              <tr key={version.id} className="border-b border-border">
                <td className="px-lg py-sm text-muted">{formatDate(version.createdAt)}</td>
                <td className="px-md py-sm text-heading">{typeOf(version, index === 0)}</td>
                <td className="max-w-[16rem] truncate px-md py-sm text-secondary" title={version.fileName}>
                  {version.fileName}
                </td>
                <td className="px-md py-sm text-right font-mono">
                  {previous ? signed(version.firms - previous.firms) : n(version.firms)}
                </td>
                <td className="px-md py-sm text-right font-mono">
                  {previous ? signed(version.contacts - previous.contacts) : n(version.contacts)}
                </td>
                <td className="px-md py-sm text-right font-mono">{n(version.firms)}</td>
                <td className="px-lg py-sm text-right font-mono">{n(version.contacts)}</td>
              </tr>
            );
          })}
          {live ? (
            <tr className="bg-background">
              <td className="px-lg py-sm text-heading">Now</td>
              <td className="px-md py-sm text-heading" colSpan={2}>
                Live: {live.fileName}
              </td>
              <td className="px-md py-sm text-right font-mono">{signed(live.firms - original.firms)}</td>
              <td className="px-md py-sm text-right font-mono">{signed(live.contacts - original.contacts)}</td>
              <td className="px-md py-sm text-right font-mono text-heading">{n(live.firms)}</td>
              <td className="px-lg py-sm text-right font-mono text-heading">{n(live.contacts)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <p className="px-lg py-md text-body-sm text-muted">
        {live ? "In the Now row, Funds and Contacts are the change since the original workbook. " : ""}
        Through Email Verification: {n(verification.leftFirm)} marked as left their firm (hidden for every client),{" "}
        {n(verification.removed)} removed for a client, {n(verification.corrected)} with a corrected email, name or
        title. These apply on top of the totals above.
      </p>
    </section>
  );
}
