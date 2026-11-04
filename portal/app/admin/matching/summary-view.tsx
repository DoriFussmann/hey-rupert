"use client";

import { Fragment, useState } from "react";
import type { Cell, Summary, SummaryTable } from "@/lib/match/summary/core";

const n = (value: number) => value.toLocaleString("en-US");

function CellView({ cell }: { cell: Cell | undefined }) {
  if (cell === undefined || cell === "") return null;
  if (typeof cell === "object") {
    return (
      <a href={cell.href} target="_blank" rel="noreferrer" className="text-primary no-underline hover:underline">
        {cell.text}
      </a>
    );
  }
  return <>{typeof cell === "number" ? n(cell) : cell}</>;
}

function TableView({ table }: { table: SummaryTable }) {
  const long = table.rows.length > 25;
  return (
    <div className="mt-md">
      {table.title ? <h4 className="mb-xs text-label uppercase tracking-label text-muted">{table.title}</h4> : null}
      <div className={long ? "max-h-[520px] overflow-auto" : "overflow-x-auto"}>
        <table className="w-full text-left text-body-sm">
          <thead className={`text-label uppercase tracking-label text-muted ${long ? "sticky top-0 bg-primary-tint" : ""}`}>
            <tr>
              {table.columns.map((c) => (
                <th key={c.key} className={`whitespace-nowrap py-xs pr-md font-medium last:pr-0 ${c.align === "right" ? "text-right" : ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i} className="border-t border-border align-top">
                {table.columns.map((c) => (
                  <td key={c.key} className={`py-xs pr-md last:pr-0 ${c.align === "right" ? "text-right tabular-nums" : ""} ${c === table.columns[0] ? "text-heading" : "text-secondary"}`}>
                    <CellView cell={row[c.key]} />
                  </td>
                ))}
              </tr>
            ))}
            {table.total ? (
              <tr className="border-t-2 border-primary">
                {table.columns.map((c) => (
                  <td key={c.key} className={`whitespace-nowrap py-xs pr-md font-medium text-heading last:pr-0 ${c.align === "right" ? "text-right tabular-nums" : ""}`}>
                    <CellView cell={table.total![c.key]} />
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * One summary card: the flow as buttons (Step 1 → Step 2A → …), the picked
 * step's name and clean tables below, and the actions at the bottom right.
 */
export function SummaryView({ summary, footer }: { summary: Summary; footer?: React.ReactNode }) {
  const [picked, setPicked] = useState(summary.steps[summary.steps.length - 1]?.key ?? "");
  const step = summary.steps.find((s) => s.key === picked) ?? summary.steps[0];
  if (!step) return null;
  return (
    <section className="rounded-card border border-primary bg-primary-tint/60 px-lg py-md">
      <h3 className="text-h4 text-heading">{summary.title}</h3>
      <nav aria-label={`${summary.title}: steps`} className="mt-sm flex flex-wrap items-center gap-xs">
        {summary.steps.map((s, i) => (
          <Fragment key={s.key}>
            {i > 0 ? <span aria-hidden className="text-muted">→</span> : null}
            <button
              type="button"
              aria-pressed={s.key === step.key}
              onClick={() => setPicked(s.key)}
              className={`whitespace-nowrap rounded-full border px-md py-[5px] text-body-sm transition-colors duration-hover ${
                s.key === step.key ? "border-primary bg-primary text-white" : "border-border bg-background text-secondary hover:border-primary hover:text-primary"
              }`}
            >
              {s.button}
            </button>
          </Fragment>
        ))}
      </nav>
      <div className="mt-md border-t border-border pt-md">
        <p className="text-h4 text-heading">{step.title}</p>
        {step.headline ? (
          <p className="mt-xs">
            <span className="text-h2 font-light text-heading">{n(step.headline.value)}</span>{" "}
            <span className="text-body-sm text-secondary">{step.headline.label}</span>
          </p>
        ) : null}
        {step.line ? <p className="text-body-sm text-muted">{step.line}</p> : null}
        {step.tables.map((t, i) =>
          t.rows.length || t.total ? <TableView key={i} table={t} /> : <p key={i} className="mt-md text-body-sm text-muted">None.</p>,
        )}
      </div>
      {footer ? <div className="mt-md flex flex-wrap items-center justify-end gap-sm">{footer}</div> : null}
    </section>
  );
}
