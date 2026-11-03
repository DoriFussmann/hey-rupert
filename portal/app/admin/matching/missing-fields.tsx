"use client";

import { useState } from "react";
import { primaryButton, secondaryButton, smallButton } from "@/app/admin/clients/[id]/match/ui";
import { MISSING_LABEL, type FillItem, type MissingField } from "@/lib/match/added/core";

const n = (value: number) => value.toLocaleString("en-US");

type Done = { ok: true } | { ok: false; error: string };
type FieldKey = "stages" | "geographies" | "sectors";
type Picked = Partial<Record<FieldKey, string[]>>;
export type FieldOptions = { stages: string[]; geographies: string[]; sectors: string[] };

const KEY: Record<MissingField, FieldKey> = { stage: "stages", geography: "geographies", sector: "sectors" };
/** How many investors one Fill-with-AI call searches at once. */
const BATCH = 4;

function fromSuggestion(item: FillItem): Picked {
  const s = item.suggestion;
  if (!s) return {};
  const out: Picked = {};
  for (const m of item.missing) if (s[KEY[m]].length) out[KEY[m]] = s[KEY[m]];
  return out;
}

/** Chips plus a dropdown to add one more: every field takes several values. */
function ChipPicker({ options, value, onChange, disabled, ai }: { options: string[]; value: string[]; onChange: (v: string[]) => void; disabled: boolean; ai: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-xs">
      {value.map((v) => (
        <span
          key={v}
          className={`inline-flex items-center gap-xs rounded-md border px-sm py-[1px] text-body-sm text-heading ${ai ? "border-warning/50 bg-warning/10" : "border-primary/40 bg-primary-tint/40"}`}
        >
          {v}
          <button type="button" aria-label={`Remove ${v}`} disabled={disabled} className="text-muted hover:text-heading" onClick={() => onChange(value.filter((x) => x !== v))}>
            ×
          </button>
        </span>
      ))}
      <select
        className="rounded-md border border-border bg-background px-sm py-[2px] text-body-sm text-body"
        value=""
        disabled={disabled}
        onChange={(e) => e.target.value && onChange([...value, e.target.value])}
      >
        <option value="">Add…</option>
        {options
          .filter((o) => !value.includes(o))
          .map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
      </select>
    </div>
  );
}

function Row({
  item,
  options,
  busy,
  onSave,
  onDismiss,
}: {
  item: FillItem;
  options: FieldOptions;
  busy: boolean;
  onSave: (fields: Picked) => void;
  onDismiss: () => void;
}) {
  const [picked, setPicked] = useState<Picked>(() => fromSuggestion(item));
  const s = item.suggestion;
  const any = Object.values(picked).some((v) => v && v.length);
  const known = (label: string, values: string[]) => (
    <div className="grid grid-cols-[96px_1fr] gap-sm">
      <span className="text-label uppercase tracking-label text-muted">{label}</span>
      <span className="text-secondary">{values.length ? values.join(", ") : "–"}</span>
    </div>
  );
  const field = (m: MissingField) => {
    const key = KEY[m];
    const stored = item[key];
    return (
      <div key={m} className="grid grid-cols-[96px_1fr] items-start gap-sm">
        <span className="pt-[2px] text-label uppercase tracking-label text-warning">{MISSING_LABEL[m]} · missing</span>
        <div>
          <ChipPicker ai={!!s && (picked[key] ?? []).length > 0} options={options[key]} value={picked[key] ?? []} disabled={busy} onChange={(v) => setPicked({ ...picked, [key]: v })} />
          {stored.length ? <p className="mt-[2px] text-body-sm text-muted">Research said {stored.join(", ")}, which the taxonomy doesn&apos;t map.</p> : null}
          {s && s.fields.includes(m) && !s[key].length ? <p className="mt-[2px] text-body-sm text-muted">AI found nothing for this.</p> : null}
        </div>
      </div>
    );
  };
  const row = (m: MissingField, label: string, values: string[]) => (item.missing.includes(m) ? field(m) : known(label, values));
  return (
    <li className="border-t border-border py-sm text-body-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <p className="text-heading">
          {item.name}{" "}
          <span className="text-muted">
            ({item.kind === "angel" ? "angel" : "fund"}, {item.status})
          </span>
          {item.website ? (
            <a className="ml-sm text-primary underline" href={item.website.startsWith("http") ? item.website : `https://${item.website}`} target="_blank" rel="noreferrer noopener">
              website ↗
            </a>
          ) : null}
          {s ? <span className="ml-sm rounded-md border border-warning/50 px-xs text-label uppercase tracking-label text-warning">AI suggestion</span> : null}
        </p>
        <span className="flex gap-xs">
          {s ? (
            <button type="button" className={smallButton} disabled={busy} onClick={onDismiss}>
              Dismiss
            </button>
          ) : null}
          <button type="button" className={smallButton} disabled={busy || !any} onClick={() => onSave(picked)}>
            {s ? "Accept" : "Save"}
          </button>
        </span>
      </div>
      <div className="mt-xs space-y-[2px]">
        {row("stage", "Stage", item.stages)}
        {row("geography", "Geography", item.geographies)}
        {row("sector", "Sector", item.sectors)}
        {known("Financing", item.financing.length ? item.financing : ["Equity (default)"])}
        {known("HQ", [item.hqCountry].filter(Boolean))}
        {item.firmType ? known("Type", [item.firmType]) : null}
      </div>
      {s && (s.note || s.sources.length) ? (
        <p className="mt-xs text-body-sm text-muted">
          {s.note ? `AI: ${s.note} ` : ""}
          {s.sources.map((src, i) => (
            <a key={src.url} className="mr-sm text-primary underline" href={src.url} target="_blank" rel="noreferrer noopener">
              {src.label || `source ${i + 1}`} ↗
            </a>
          ))}
        </p>
      ) : null}
    </li>
  );
}

/**
 * The added investors still missing a stage, geography or sector: every
 * field shown, Fill missing fields with AI for all of them, and Accept per
 * row or for all. Used in Step 3A and on the Fund Database page.
 */
export function MissingFields({
  items,
  options,
  suggest,
  save,
  dismiss,
  onChanged,
}: {
  items: FillItem[];
  options: FieldOptions;
  suggest: (ids: string[]) => Promise<{ ok: true; problems: string[] } | { ok: false; error: string }>;
  save: (id: string, fields: Picked) => Promise<Done>;
  dismiss: (id: string) => Promise<Done>;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const toSearch = items.filter((i) => !i.suggestion);
  const toAccept = items.filter((i) => Object.values(fromSuggestion(i)).some((v) => v && v.length));

  async function fillAll() {
    setBusy("ai");
    setProblems([]);
    const ids = toSearch.map((i) => i.addedId);
    const found: string[] = [];
    for (let at = 0; at < ids.length; at += BATCH) {
      setProgress(`Searching ${n(Math.min(at + BATCH, ids.length))} of ${n(ids.length)}…`);
      const result = await suggest(ids.slice(at, at + BATCH));
      if (!result.ok) {
        found.push(result.error);
        break;
      }
      found.push(...result.problems);
    }
    setProgress(null);
    setProblems(found);
    await onChanged();
    setBusy(null);
  }

  async function acceptAll() {
    setBusy("accept");
    setProblems([]);
    const found: string[] = [];
    let i = 0;
    for (const item of toAccept) {
      i += 1;
      setProgress(`Accepting ${n(i)} of ${n(toAccept.length)}…`);
      const result = await save(item.addedId, fromSuggestion(item));
      if (!result.ok) found.push(`${item.name}: ${result.error}`);
    }
    setProgress(null);
    setProblems(found);
    await onChanged();
    setBusy(null);
  }

  async function one(label: string, action: () => Promise<Done>) {
    setBusy(label);
    const result = await action();
    if (!result.ok) setProblems([result.error]);
    else setProblems([]);
    await onChanged();
    setBusy(null);
  }

  if (!items.length) return <p className="text-body-sm text-success">✓ No added investor is missing a field.</p>;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-sm">
        <button type="button" className={primaryButton} disabled={busy !== null || !toSearch.length} onClick={() => void fillAll()}>
          {busy === "ai" ? "Searching…" : `Fill missing fields with AI (${n(toSearch.length)})`}
        </button>
        <button type="button" className={secondaryButton} disabled={busy !== null || !toAccept.length} onClick={() => void acceptAll()}>
          {busy === "accept" ? "Accepting…" : `Accept all suggestions (${n(toAccept.length)})`}
        </button>
        {progress ? <span className="text-body-sm text-primary">{progress}</span> : null}
      </div>
      <p className="mt-xs text-body-sm text-muted">
        AI suggestions are marked and count only once you accept them. You can also pick values yourself; every field takes several.
      </p>
      {problems.length ? (
        <ul className="mt-sm list-disc pl-lg text-body-sm text-error">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      <ul className="mt-sm">
        {items.map((item) => (
          <Row
            key={`${item.addedId}-${item.suggestion?.at ?? ""}`}
            item={item}
            options={options}
            busy={busy !== null}
            onSave={(fields) => void one(`save-${item.addedId}`, () => save(item.addedId, fields))}
            onDismiss={() => void one(`dismiss-${item.addedId}`, () => dismiss(item.addedId))}
          />
        ))}
      </ul>
    </div>
  );
}
