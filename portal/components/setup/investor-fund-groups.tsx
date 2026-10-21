"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "@/components/chevron";
import { fitTiersFor, type InvestorRow, type TierScheme } from "@/lib/setup";

/** Rows shown when a panel opens; "Show more" adds the same again. */
const PAGE_SIZE = 25;

/** Fund type is the first part of the details line ("Venture Capital · …"). */
export function fundTypeOf(row: InvestorRow) {
  return row.details.split("·")[0]?.trim() || "Other";
}

function groupsOf(rows: InvestorRow[]) {
  const grouped = new Map<string, InvestorRow[]>();
  for (const row of rows) {
    const type = fundTypeOf(row);
    const list = grouped.get(type) ?? [];
    list.push(row);
    grouped.set(type, list);
  }
  return Array.from(grouped.entries()).sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );
}

/**
 * A long investor list as collapsed panels, one per fund type inside each
 * tier. Rows render only after a panel is opened, a page at a time.
 */
export function InvestorFundGroups({
  rows,
  scheme,
  renderRow,
}: {
  rows: InvestorRow[];
  scheme?: TierScheme;
  renderRow: (row: InvestorRow) => ReactNode;
}) {
  const tiers = useMemo(
    () =>
      fitTiersFor(scheme).map((tier) => ({
        ...tier,
        groups: groupsOf(rows.filter((row) => row.tier === tier.tier)),
      })).filter((tier) => tier.groups.length > 0),
    [rows, scheme],
  );
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [shown, setShown] = useState<Record<string, number>>({});
  const keys = tiers.flatMap((tier) =>
    tier.groups.map(([type]) => `${tier.tier}:${type}`),
  );
  const anyOpen = keys.some((key) => open[key]);

  function toggle(key: string) {
    setOpen((current) => ({ ...current, [key]: !current[key] }));
  }

  if (tiers.length === 0) return null;

  return (
    <div className="space-y-md">
      <div className="flex justify-end px-lg">
        <button
          type="button"
          className="text-body-sm text-primary hover:text-primary-hover"
          onClick={() => {
            if (anyOpen) {
              setOpen({});
              return;
            }
            const next: Record<string, boolean> = {};
            for (const key of keys) next[key] = true;
            setOpen(next);
          }}
        >
          {anyOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {tiers.map((tier) => (
        <section key={tier.tier} className="overflow-hidden rounded-card border border-border bg-surface">
          <div className="border-b border-border px-lg py-md">
            <h2 className="text-h4">
              {tier.label} <span className="text-muted">· {tier.detail}</span>
            </h2>
            <p className="mt-xs text-body-sm text-muted">
              {tier.groups.reduce((sum, [, list]) => sum + list.length, 0)} funds · {tier.groups.length}{" "}
              {tier.groups.length === 1 ? "type" : "types"}
            </p>
          </div>
          <div className="divide-y divide-border">
            {tier.groups.map(([type, list]) => {
              const key = `${tier.tier}:${type}`;
              const expanded = Boolean(open[key]);
              const limit = shown[key] ?? PAGE_SIZE;
              const remaining = list.length - limit;
              return (
                <div key={key}>
                  <button
                    type="button"
                    className="flex min-h-[48px] w-full items-center justify-between gap-sm px-lg py-md text-left transition-colors duration-hover hover:bg-background"
                    aria-expanded={expanded}
                    onClick={() => toggle(key)}
                  >
                    <span className="text-body-sm text-heading">{type}</span>
                    <span className="flex shrink-0 items-center gap-sm text-body-sm text-muted">
                      {list.length} {list.length === 1 ? "fund" : "funds"}
                      <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface">
                        <ChevronDown
                          className={`h-4 w-4 transition-transform duration-hover ${expanded ? "rotate-180" : ""}`}
                        />
                      </span>
                    </span>
                  </button>
                  {expanded ? (
                    <>
                      <ul className="divide-y divide-border border-t border-border">
                        {list.slice(0, limit).map(renderRow)}
                      </ul>
                      {remaining > 0 ? (
                        <div className="flex flex-wrap items-center gap-md border-t border-border px-lg py-sm">
                          <button
                            type="button"
                            className="text-body-sm text-primary hover:text-primary-hover"
                            onClick={() => setShown((current) => ({ ...current, [key]: limit + PAGE_SIZE }))}
                          >
                            Show {Math.min(PAGE_SIZE, remaining)} more
                          </button>
                          <button
                            type="button"
                            className="text-body-sm text-muted hover:text-heading"
                            onClick={() => setShown((current) => ({ ...current, [key]: list.length }))}
                          >
                            Show all {list.length}
                          </button>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
