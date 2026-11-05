"use client";

import { useId, useMemo, useState } from "react";

const n = (value: number) => value.toLocaleString("en-US");

/** A filter: the values a row has for it (a row may have several, e.g. more than one source). */
export type FilterDef<T> = { key: string; label: string; values: (row: T) => string[] };

/**
 * Search (by name, with suggestions) and dropdown filters over a list.
 * A filter with only one value that every row has is hidden: it would filter nothing.
 */
export function useListFilter<T>(rows: T[], name: (row: T) => string, defs: FilterDef<T>[]) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const filters = useMemo(
    () =>
      defs
        .map((def) => {
          const counts = new Map<string, number>();
          for (const row of rows) for (const v of Array.from(new Set(def.values(row).filter(Boolean)))) counts.set(v, (counts.get(v) ?? 0) + 1);
          return { def, options: Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) };
        })
        .filter((f) => f.options.length > 1 || (f.options.length === 1 && f.options[0][1] < rows.length)),
    // defs are rebuilt on each render by callers; their keys are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, defs.map((d) => d.key).join("|")],
  );
  const names = useMemo(() => Array.from(new Set(rows.map(name).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [rows, name]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const active = filters.map((f) => [f.def, picked[f.def.key]] as const).filter(([, v]) => v);
    return rows
      .map((row, i) => ({ row, i }))
      .filter(({ row }) => (!q || name(row).toLowerCase().includes(q)) && active.every(([def, v]) => def.values(row).includes(v as string)));
  }, [rows, query, picked, filters, name]);
  const filtering = Boolean(query.trim()) || filters.some((f) => picked[f.def.key]);
  const clear = () => {
    setQuery("");
    setPicked({});
  };
  return { query, setQuery, picked, setPicked, filters, names, shown, filtering, clear, total: rows.length };
}

export type ListFilter<T> = ReturnType<typeof useListFilter<T>>;

/** The search box (suggestions from the names), the filter dropdowns, the count and Clear. */
export function ListFilterBar<T>({ list, label, noun = "", onChange }: { list: ListFilter<T>; label: string; noun?: string; onChange?: () => void }) {
  const listId = useId();
  const field = "rounded-md border border-border bg-surface px-sm py-[5px] text-body-sm text-heading";
  const q = list.query.trim().toLowerCase();
  return (
    <div className="mb-sm flex flex-wrap items-center gap-sm">
      <input
        type="search"
        className={`${field} w-56`}
        placeholder={`Search by ${label.toLowerCase()}`}
        aria-label={`Search by ${label.toLowerCase()}`}
        value={list.query}
        list={listId}
        onChange={(e) => {
          list.setQuery(e.target.value);
          onChange?.();
        }}
      />
      <datalist id={listId}>
        {q
          ? list.names
              .filter((x) => x.toLowerCase().includes(q))
              .slice(0, 12)
              .map((x) => <option key={x} value={x} />)
          : null}
      </datalist>
      {list.filters.map(({ def, options }) => (
        <select
          key={def.key}
          className={field}
          aria-label={`Filter by ${def.label}`}
          value={list.picked[def.key] ?? ""}
          onChange={(e) => {
            list.setPicked({ ...list.picked, [def.key]: e.target.value });
            onChange?.();
          }}
        >
          <option value="">{def.label}: all</option>
          {options.map(([value, count]) => (
            <option key={value} value={value}>
              {value} ({n(count)})
            </option>
          ))}
        </select>
      ))}
      <span className="text-body-sm text-muted">
        {list.filtering ? `${n(list.shown.length)} of ${n(list.total)}` : `${n(list.total)} in all`}
        {noun ? ` ${noun}` : ""}
      </span>
      {list.filtering ? (
        <button
          type="button"
          className="text-body-sm text-primary hover:underline"
          onClick={() => {
            list.clear();
            onChange?.();
          }}
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
