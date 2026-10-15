import { FIT_TIERS, type InvestorListSummary } from "@/lib/setup";

function n(value: number) {
  return value.toLocaleString("en-US");
}

/** Funds and contact counts per tier. Never names people. */
export function InvestorListSummaryPanel({ summary }: { summary: InvestorListSummary }) {
  return (
    <div className="grid gap-sm md:grid-cols-3">
      {FIT_TIERS.map(({ tier, label, detail }) => {
        const entry = summary.tiers.find((item) => item.tier === tier);
        if (!entry) return null;
        return (
          <div key={tier} className="rounded-card border border-border bg-surface px-md py-md">
            <p className="text-label uppercase tracking-label text-muted">
              {label} · {detail}
            </p>
            <p className="mt-xs text-h4 text-heading">
              {n(entry.funds)} fund{entry.funds === 1 ? "" : "s"}
            </p>
            <p className="text-body-sm text-secondary">
              {n(entry.contacts)} investing contact{entry.contacts === 1 ? "" : "s"} identified
            </p>
            {entry.by_type.length > 0 ? (
              <ul className="mt-sm space-y-px text-body-sm text-muted">
                {entry.by_type.map((type) => (
                  <li key={type.label}>
                    {type.label}: {n(type.funds)} fund{type.funds === 1 ? "" : "s"} · {n(type.contacts)} contact
                    {type.contacts === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
