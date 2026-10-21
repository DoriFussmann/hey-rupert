"use client";

import { useMemo, useState } from "react";
import {
  approveValue,
  mapValue,
  resolveValueSuggestion,
  suggestValueMappings,
} from "@/app/admin/taxonomy-actions";
import { inputClass, labelClass, n, primaryButton, secondaryButton, smallButton } from "@/app/admin/clients/[id]/match/ui";
import { ErrorLine, useAction } from "@/app/admin/taxonomy/use-action";
import { Select } from "@/components/select";
import { FIELDS, fieldOf, rawKey, type FieldKey, type TaxAlias, type TaxNode } from "@/lib/taxonomy/core";

export type ValueItem = TaxAlias & { firms: number; broken: boolean };

const PAGE = 50;

const METHOD_LABEL: Record<TaxAlias["method"], string> = {
  seed: "seeded",
  import: "found in data",
  manual: "set by an admin",
  ai: "AI suggestion, accepted",
};

function needsAttention(value: ValueItem) {
  return value.state === "unmapped" || value.review === "needs_review" || value.broken || !!value.aiProposal;
}

function Chip({ tone, children }: { tone: "ok" | "warn" | "error" | "muted"; children: React.ReactNode }) {
  const color = { ok: "text-success", warn: "text-warning", error: "text-error", muted: "text-muted" }[tone];
  return (
    <span className={`inline-flex rounded-full border border-border px-sm py-px text-label uppercase tracking-label ${color}`}>
      {children}
    </span>
  );
}

function StatusChips({ value }: { value: ValueItem }) {
  return (
    <span className="flex flex-wrap gap-xs">
      {value.state === "unmapped" ? <Chip tone="error">Not mapped</Chip> : null}
      {value.state === "ignored" ? <Chip tone="muted">Ignored</Chip> : null}
      {value.state !== "unmapped" && value.review === "needs_review" ? <Chip tone="warn">Needs review</Chip> : null}
      {value.state !== "unmapped" && value.review === "approved" ? <Chip tone="ok">Approved</Chip> : null}
      {value.broken ? <Chip tone="error">Broken link</Chip> : null}
    </span>
  );
}

function Editor({
  value,
  candidates,
  parentLabel,
  onClose,
}: {
  value: ValueItem;
  candidates: TaxNode[];
  parentLabel: (id: string) => string;
  onClose: () => void;
}) {
  const { pending, error, run } = useAction();
  const [state, setState] = useState<"mapped" | "ignored">(value.state === "ignored" ? "ignored" : "mapped");
  const [picked, setPicked] = useState<string[]>(value.state === "mapped" ? value.nodeIds : value.aiProposal?.nodeIds ?? []);
  const [query, setQuery] = useState("");
  const [rationale, setRationale] = useState(value.method === "manual" ? value.rationale : "");
  const shown = candidates.filter(
    (node) => picked.includes(node.id) || !query || rawKey(node.label).includes(rawKey(query)),
  );

  async function save() {
    const saved = await run(() => mapValue({ field: value.field, rawKey: value.rawKey, state, nodeIds: picked, rationale }));
    if (saved) onClose();
  }

  return (
    <div className="mt-sm space-y-sm rounded-md border border-border bg-background p-md">
      <fieldset className="flex flex-wrap gap-md text-body-sm">
        <legend className="sr-only">Decision</legend>
        <label className="flex items-center gap-xs">
          <input type="radio" checked={state === "mapped"} onChange={() => setState("mapped")} /> Map to categories
        </label>
        <label className="flex items-center gap-xs">
          <input type="radio" checked={state === "ignored"} onChange={() => setState("ignored")} /> Ignore (carries no
          meaning)
        </label>
      </fieldset>
      {state === "mapped" ? (
        <div>
          <label className={labelClass} htmlFor={`find-${value.field}-${value.rawKey}`}>
            Categories ({picked.length} picked)
          </label>
          <input
            id={`find-${value.field}-${value.rawKey}`}
            className={`${inputClass} mt-xs`}
            placeholder="Filter categories"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="mt-xs max-h-56 overflow-y-auto rounded-md border border-border bg-surface p-sm">
            {shown.length === 0 ? <p className="text-body-sm text-muted">No category matches.</p> : null}
            {shown.map((node) => (
              <label key={node.id} className="flex items-center gap-xs py-px text-body-sm">
                <input
                  type="checkbox"
                  checked={picked.includes(node.id)}
                  onChange={(event) =>
                    setPicked((current) =>
                      event.target.checked ? [...current, node.id] : current.filter((id) => id !== node.id),
                    )
                  }
                />
                <span className="text-heading">{node.label}</span>
                <span className="text-label text-muted">
                  {node.parentId ? `in ${parentLabel(node.parentId)} · ` : ""}
                  <span className="font-mono">{node.id}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-xs text-body-sm text-muted">
            Pick more than one only when the value genuinely spans them. A missing category can be added under Categories.
          </p>
        </div>
      ) : null}
      <div>
        <label className={labelClass} htmlFor={`why-${value.field}-${value.rawKey}`}>
          Reason {state === "ignored" ? "(required)" : "(optional)"}
        </label>
        <textarea
          id={`why-${value.field}-${value.rawKey}`}
          className={`${inputClass} mt-xs`}
          rows={2}
          maxLength={600}
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-sm">
        <button type="button" className={primaryButton} disabled={pending} onClick={save}>
          Save and approve
        </button>
        <button type="button" className={secondaryButton} disabled={pending} onClick={onClose}>
          Cancel
        </button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

function ValueRowItem({ value, nodes }: { value: ValueItem; nodes: Map<string, TaxNode> }) {
  const { pending, error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const field = fieldOf(value.field);
  const label = (id: string) => nodes.get(id)?.label ?? id;
  const candidates = useMemo(
    () =>
      Array.from(nodes.values()).filter(
        (node) => node.dimension === field?.dimension && node.status === "active" && node.kind !== "group",
      ),
    [nodes, field?.dimension],
  );

  return (
    <li className="border-b border-border py-sm">
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="min-w-0">
          <p className="text-body-sm">
            <span className="text-heading">{value.rawValue}</span>{" "}
            <span className="text-muted">
              · {field?.label} · {n(value.firms)} firm{value.firms === 1 ? "" : "s"}
            </span>
          </p>
          <div className="mt-xs flex flex-wrap items-center gap-sm text-body-sm">
            <StatusChips value={value} />
            {value.state === "mapped" ? (
              <span className="text-secondary">→ {value.nodeIds.map(label).join(", ")}</span>
            ) : null}
            {value.state !== "unmapped" ? <span className="text-muted">({METHOD_LABEL[value.method]})</span> : null}
          </div>
          {value.rationale && value.state !== "unmapped" ? (
            <p className="mt-xs text-body-sm text-muted">{value.rationale}</p>
          ) : null}
          {value.aiProposal ? (
            <div className="mt-sm rounded-md border border-primary/30 bg-background px-md py-sm text-body-sm">
              <p className="text-label uppercase tracking-label text-primary">
                AI suggestion · {Math.round(value.aiProposal.confidence * 100)}% confident · not applied
              </p>
              <p className="mt-xs text-heading">
                {value.aiProposal.nodeIds.length ? value.aiProposal.nodeIds.map(label).join(", ") : "No category fits"}
              </p>
              {value.aiProposal.rationale ? <p className="text-muted">{value.aiProposal.rationale}</p> : null}
              <div className="mt-xs flex gap-sm">
                {value.aiProposal.nodeIds.length ? (
                  <button
                    type="button"
                    className={smallButton}
                    disabled={pending}
                    onClick={() => run(() => resolveValueSuggestion(value.field, value.rawKey, true))}
                  >
                    Accept
                  </button>
                ) : null}
                <button
                  type="button"
                  className={smallButton}
                  disabled={pending}
                  onClick={() => run(() => resolveValueSuggestion(value.field, value.rawKey, false))}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-sm">
          {value.state !== "unmapped" && value.review === "needs_review" && !value.broken ? (
            <button type="button" className={smallButton} disabled={pending} onClick={() => run(() => approveValue(value.field, value.rawKey))}>
              Approve
            </button>
          ) : null}
          <button type="button" className={smallButton} disabled={pending} onClick={() => setEditing((open) => !open)}>
            {value.state === "unmapped" ? "Map" : "Edit"}
          </button>
        </div>
      </div>
      <ErrorLine error={error} />
      {editing ? <Editor value={value} candidates={candidates} parentLabel={label} onClose={() => setEditing(false)} /> : null}
    </li>
  );
}

export function ValueReview({ values, nodes }: { values: ValueItem[]; nodes: TaxNode[] }) {
  const { pending, error, run } = useAction();
  const [view, setView] = useState<"attention" | "all">("attention");
  const [field, setField] = useState<FieldKey | "">("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [note, setNote] = useState<string | null>(null);
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  const filtered = values
    .filter((value) => (view === "all" ? true : needsAttention(value)))
    .filter((value) => (field ? value.field === field : true))
    .filter((value) => (query ? rawKey(value.rawValue).includes(rawKey(query)) : true))
    .sort((a, b) => b.firms - a.firms || a.rawValue.localeCompare(b.rawValue));
  const attention = values.filter(needsAttention).length;
  const askable = field ? values.filter((value) => value.field === field && value.state === "unmapped" && !value.aiProposal).length : 0;

  async function suggest() {
    if (!field) return;
    setNote(null);
    const result = await run(() => suggestValueMappings(field));
    if (result) {
      setNote(
        `${result.proposed} suggestion${result.proposed === 1 ? "" : "s"} added for review.${result.remaining > 0 ? ` ${result.remaining} values left: run again.` : ""}`,
      );
    }
  }

  return (
    <div className="rounded-card border border-border bg-surface px-lg py-md">
      <p className="max-w-prose text-body-sm text-muted">
        Every distinct value the provider uses, per field. A value can map to several categories. Suggestions from AI are
        kept apart and change nothing until you accept them.
      </p>
      <div className="mt-md grid gap-sm sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="value-view">
            Show
          </label>
          <Select id="value-view" value={view} onChange={(event) => setView(event.target.value as "attention" | "all")}>
            <option value="attention">Needs attention ({n(attention)})</option>
            <option value="all">All values ({n(values.length)})</option>
          </Select>
        </div>
        <div>
          <label className={labelClass} htmlFor="value-field">
            Field
          </label>
          <Select id="value-field" value={field} onChange={(event) => setField(event.target.value as FieldKey | "")}>
            <option value="">All fields</option>
            {FIELDS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className={labelClass} htmlFor="value-search">
            Search
          </label>
          <input
            id="value-search"
            className={`${inputClass} mt-sm`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Value"
          />
        </div>
      </div>
      <div className="mt-sm flex flex-wrap items-center gap-sm">
        <button type="button" className={secondaryButton} disabled={pending || !field || askable === 0} onClick={suggest}>
          {pending ? "Asking AI…" : field ? `Suggest mappings with AI (${n(askable)} unmapped)` : "Pick a field to get AI suggestions"}
        </button>
        {note ? (
          <span role="status" className="text-body-sm text-success">
            {note}
          </span>
        ) : null}
      </div>
      <ErrorLine error={error} />

      {filtered.length === 0 ? (
        <p className="mt-md text-body-sm text-muted">
          {view === "attention" ? "Nothing needs attention here." : "No values match."}
        </p>
      ) : (
        <ul className="mt-md">
          {filtered.slice(0, limit).map((value) => (
            <ValueRowItem key={`${value.field}|${value.rawKey}`} value={value} nodes={byId} />
          ))}
        </ul>
      )}
      {filtered.length > limit ? (
        <button type="button" className={`${smallButton} mt-sm`} onClick={() => setLimit((current) => current + PAGE)}>
          Show more ({n(filtered.length - limit)} left)
        </button>
      ) : null}
    </div>
  );
}
