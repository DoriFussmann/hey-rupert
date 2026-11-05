"use client";

import { Fragment, useEffect, useId, useMemo, useState } from "react";
import { cellText, type Cell, type Detail, type Summary, type SummaryTable } from "@/lib/match/summary/core";

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

function DetailModal({ title, item, details, onClose }: { title: string; item?: string; details: Detail[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const shown = details.filter((d) => (Array.isArray(d.value) ? d.value.length : d.value !== "" && d.value !== undefined));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-heading/40 p-md" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-slide-in max-h-[88vh] w-full max-w-2xl overflow-auto rounded-card border border-border bg-surface px-lg py-md shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-md">
          <div>
            {item ? <p className="text-label uppercase tracking-label text-muted">{item}</p> : null}
            <h3 className="text-h3 text-heading">{title}</h3>
          </div>
          <button type="button" className="rounded-md border border-border bg-surface px-sm py-[3px] text-body-sm text-secondary hover:text-heading" onClick={onClose}>
            Close
          </button>
        </div>
        <dl className="mt-md divide-y divide-border text-body-sm">
          {shown.map((d) => (
            <div key={d.label} className="grid gap-xs py-sm sm:grid-cols-[12rem_1fr]">
              <dt className="text-muted">{d.label}</dt>
              <dd className="text-heading">
                {Array.isArray(d.value) ? (
                  <ul className="space-y-xs">
                    {d.value.map((v, i) => (
                      <li key={i}>
                        <CellView cell={v} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <CellView cell={d.value} />
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

const PAGE = 100;
const tokens = (cell: Cell | undefined) =>
  cellText(cell)
    .split(", ")
    .map((x) => x.trim())
    .filter(Boolean);

/** Search (with suggestions from the names) and the column filters, for a long list. */
function useListFilter(table: SummaryTable, nameKey: string) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const filters = useMemo(
    () =>
      table.search
        ? table.columns
            .filter((c) => c.filter)
            .map((c) => {
              const counts = new Map<string, number>();
              for (const row of table.rows) for (const t of tokens(row[c.key])) counts.set(t, (counts.get(t) ?? 0) + 1);
              return { column: c, options: Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) };
            })
            .filter((f) => f.options.length > 1 || (f.options.length === 1 && f.options[0][1] < table.rows.length))
        : [],
    [table],
  );
  const names = useMemo(() => Array.from(new Set(table.rows.map((r) => cellText(r[nameKey])).filter(Boolean))).sort(), [table, nameKey]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const active = Object.entries(picked).filter(([, v]) => v);
    return table.rows
      .map((row, i) => ({ row, i }))
      .filter(({ row }) => (!q || cellText(row[nameKey]).toLowerCase().includes(q)) && active.every(([k, v]) => tokens(row[k]).includes(v)));
  }, [table, query, picked, nameKey]);
  const filtering = Boolean(query.trim()) || Object.values(picked).some(Boolean);
  return { query, setQuery, picked, setPicked, filters, names, shown, filtering };
}

function TableView({ table }: { table: SummaryTable }) {
  const [open, setOpen] = useState<number | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const clickable = Boolean(table.details?.length);
  // The item's name: the "name" column when there is one (the first column may be a number).
  const nameCol = table.columns.find((c) => c.key === "name") ?? table.columns[0];
  const list = useListFilter(table, nameCol.key);
  const rows = table.search ? list.shown : table.rows.map((row, i) => ({ row, i }));
  const visible = table.search ? rows.slice(0, limit) : rows;
  const long = visible.length > 25;
  const listId = useId();
  const field = "rounded-md border border-border bg-surface px-sm py-[5px] text-body-sm text-heading";
  return (
    <div className="mt-md">
      {table.title ? <h4 className="mb-xs text-label uppercase tracking-label text-muted">{table.title}</h4> : null}
      {table.search ? (
        <div className="mb-sm flex flex-wrap items-center gap-sm">
          <input
            type="search"
            className={`${field} w-56`}
            placeholder={`Search by ${nameCol.label.toLowerCase()}`}
            aria-label={`Search ${table.title ?? "the list"}`}
            value={list.query}
            list={listId}
            onChange={(e) => {
              list.setQuery(e.target.value);
              setLimit(PAGE);
            }}
          />
          <datalist id={listId}>
            {list.query.trim().length >= 1
              ? list.names
                  .filter((x) => x.toLowerCase().includes(list.query.trim().toLowerCase()))
                  .slice(0, 12)
                  .map((x) => <option key={x} value={x} />)
              : null}
          </datalist>
          {list.filters.map(({ column, options }) => (
            <select
              key={column.key}
              className={field}
              aria-label={`Filter by ${column.label}`}
              value={list.picked[column.key] ?? ""}
              onChange={(e) => {
                list.setPicked({ ...list.picked, [column.key]: e.target.value });
                setLimit(PAGE);
              }}
            >
              <option value="">{column.label}: all</option>
              {options.map(([value, count]) => (
                <option key={value} value={value}>
                  {value} ({n(count)})
                </option>
              ))}
            </select>
          ))}
          <span className="text-body-sm text-muted">
            {list.filtering ? `${n(rows.length)} of ${n(table.rows.length)}` : `${n(table.rows.length)} in all`}
          </span>
          {list.filtering ? (
            <button
              type="button"
              className="text-body-sm text-primary hover:underline"
              onClick={() => {
                list.setQuery("");
                list.setPicked({});
                setLimit(PAGE);
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
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
            {visible.map(({ row, i }) => (
              <tr
                key={i}
                className={`border-t border-border ${clickable ? "cursor-pointer hover:bg-surface/70 focus:bg-surface/70 focus:outline-none" : ""}`}
                onClick={clickable ? () => setOpen(i) : undefined}
                onKeyDown={clickable ? (e) => (e.key === "Enter" ? setOpen(i) : undefined) : undefined}
                tabIndex={clickable ? 0 : undefined}
              >
                {table.columns.map((c) => (
                  <td
                    key={c.key}
                    className={`max-w-[18rem] truncate whitespace-nowrap py-xs pr-md last:pr-0 ${c.align === "right" ? "text-right tabular-nums" : ""} ${
                      c === nameCol ? `text-heading ${clickable ? "underline decoration-border underline-offset-4" : ""}` : "text-secondary"
                    }`}
                  >
                    <CellView cell={row[c.key]} />
                  </td>
                ))}
              </tr>
            ))}
            {table.total && !list.filtering ? (
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
        {table.search && !rows.length ? <p className="py-sm text-body-sm text-muted">No match.</p> : null}
      </div>
      <div className="mt-xs flex flex-wrap items-center gap-md">
        {clickable && rows.length ? <p className="text-body-sm text-muted">Click a row for the details.</p> : null}
        {table.search && rows.length > visible.length ? (
          <button type="button" className="text-body-sm text-primary hover:underline" onClick={() => setLimit(limit + PAGE * 5)}>
            Show more ({n(rows.length - visible.length)} left)
          </button>
        ) : null}
      </div>
      {open !== null && table.details?.[open] ? (
        <DetailModal
          title={cellText(table.rows[open][nameCol.key])}
          item={table.item}
          details={table.details[open]}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * One summary card: the flow as buttons (Step 1 → Step 2A → …), the picked
 * step's name and clean tables below, and the actions at the bottom right.
 */
export function SummaryView({ summary, footer }: { summary: Summary; footer?: React.ReactNode }) {
  // Opens on the first step: Step 1, and Competitors for the landscape.
  const [picked, setPicked] = useState(summary.steps[0]?.key ?? "");
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
              className={`whitespace-nowrap rounded-md border px-md py-[5px] text-body-sm transition-colors duration-hover ${
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
