"use client";

import { useState } from "react";
import { saveOutreachStyles } from "@/app/admin/outreach-actions";
import {
  COPY_SECTIONS,
  CTA_LABEL,
  DEFAULT_PRESET_ID,
  FUND_TYPES,
  MERGE_FIELD_HELP,
  SECTION_LABEL,
  defaultOutreachStyles,
  matrixKey,
  type CtaKind,
  type OutreachStyles,
  type StylePreset,
} from "@/lib/outreach/copy";

const fieldClass =
  "mt-sm w-full rounded-md border border-border bg-background px-sm py-sm font-sans text-body-sm normal-case tracking-normal text-body outline-none focus:border-primary";
const labelClass = "block text-label uppercase tracking-label text-muted";
const smallButton =
  "rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

function newId(label: string, taken: Set<string>) {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "style";
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}_${n}`;
  return id;
}

export function OutreachStylesEditor({ initial, saved }: { initial: OutreachStyles; saved: boolean }) {
  const [styles, setStyles] = useState<OutreachStyles>(initial);
  const [savedKey, setSavedKey] = useState(JSON.stringify(initial));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(
    saved ? null : { kind: "ok", text: "Showing the default styles. Save to keep your changes." },
  );
  const dirty = JSON.stringify(styles) !== savedKey;
  const used = new Set(Object.values(styles.matrix));

  function updatePreset(index: number, patch: Partial<StylePreset>) {
    setStyles((current) => ({
      ...current,
      presets: current.presets.map((preset, i) => (i === index ? { ...preset, ...patch } : preset)),
    }));
  }

  function setCell(key: string, id: string) {
    setStyles((current) => {
      const matrix = { ...current.matrix };
      if (id) matrix[key] = id;
      else delete matrix[key];
      return { ...current, matrix };
    });
  }

  function addPreset() {
    setStyles((current) => {
      const label = "New style";
      const id = newId(label, new Set(current.presets.map((preset) => preset.id)));
      return {
        ...current,
        presets: [
          ...current.presets,
          { id, label, rules: "", max_words: 100, proof_points: 1, cta: "question", example: "" },
        ],
      };
    });
  }

  function removePreset(index: number) {
    setStyles((current) => ({ ...current, presets: current.presets.filter((_, i) => i !== index) }));
  }

  async function onSave() {
    setPending(true);
    setMessage(null);
    try {
      const result = await saveOutreachStyles(styles);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setStyles(result.styles);
      setSavedKey(JSON.stringify(result.styles));
      setMessage({ kind: "ok", text: "Saved. New drafts use these styles; copy already drafted keeps its own." });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Unable to save." });
    } finally {
      setPending(false);
    }
  }

  function restoreDefaults() {
    if (!window.confirm("Replace every style and choice on this page with the defaults? Nothing is saved until you click Save.")) return;
    setStyles(defaultOutreachStyles());
  }

  return (
    <div className="space-y-lg">
      <section className="rounded-card border border-border bg-surface">
        <div className="border-b border-border px-lg py-lg">
          <h2 className="text-h4">Which style writes which emails</h2>
          <p className="mt-xs text-body-sm text-muted">
            Core emails are personalized per contact from this style. Sphere, Tier 3 and Tier 4 share one sequence per
            fund type, with a line per tier. A fund type left on Default uses the first row.
          </p>
        </div>
        <div className="overflow-x-auto px-lg py-md">
          <table className="w-full min-w-[560px] text-left text-body-sm">
            <thead>
              <tr className="text-label uppercase tracking-label text-muted">
                <th className="py-sm pr-md font-medium">Fund type</th>
                {COPY_SECTIONS.map((section) => (
                  <th key={section} className="py-sm pr-md font-medium">
                    {SECTION_LABEL[section]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(["*", ...FUND_TYPES] as const).map((type) => (
                <tr key={type} className="border-t border-border">
                  <td className="py-sm pr-md text-heading">{type === "*" ? "Default" : type}</td>
                  {COPY_SECTIONS.map((section) => {
                    const key = matrixKey(section, type);
                    return (
                      <td key={section} className="py-sm pr-md">
                        <select
                          className="w-full rounded-md border border-border bg-background px-sm py-xs text-body-sm text-body outline-none focus:border-primary"
                          value={styles.matrix[key] ?? ""}
                          onChange={(event) => setCell(key, event.target.value)}
                          aria-label={`${type === "*" ? "Default" : type}, ${SECTION_LABEL[section]}`}
                        >
                          {type === "*" ? null : <option value="">Default</option>}
                          {styles.presets.map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border px-lg py-md">
          <label className={labelClass}>
            Opt-out line, added under the first email of every sequence
            <input
              className={fieldClass}
              value={styles.opt_out_line}
              maxLength={300}
              onChange={(event) => setStyles((current) => ({ ...current, opt_out_line: event.target.value }))}
              placeholder="Blank: no opt-out line"
            />
          </label>
        </div>
      </section>

      <section className="rounded-card border border-border bg-surface">
        <div className="border-b border-border px-lg py-lg">
          <h2 className="text-h4">Styles</h2>
          <p className="mt-xs text-body-sm text-muted">
            The rules go to the AI as written. The example shows the shape only; its facts are never copied. Fields you
            can use:{" "}
            {Object.entries(MERGE_FIELD_HELP).map(([field, help], index) => (
              <span key={field}>
                {index ? "; " : ""}
                <code className="font-mono">{`{{${field}}}`}</code> {help.toLowerCase()}
              </span>
            ))}
            .
          </p>
        </div>
        <ol>
          {styles.presets.map((preset, index) => {
            const inUse = used.has(preset.id);
            return (
              <li key={preset.id} className="border-b border-border px-lg py-md last:border-b-0">
                <div className="grid gap-md lg:grid-cols-2">
                  <div className="grid gap-sm">
                    <label className={labelClass}>
                      Name
                      <input
                        className={fieldClass}
                        value={preset.label}
                        maxLength={60}
                        onChange={(event) => updatePreset(index, { label: event.target.value })}
                      />
                    </label>
                    <label className={labelClass}>
                      Rules
                      <textarea
                        className={`${fieldClass} min-h-[140px] resize-y`}
                        value={preset.rules}
                        maxLength={4000}
                        onChange={(event) => updatePreset(index, { rules: event.target.value })}
                        placeholder="One rule per line"
                      />
                    </label>
                    <div className="flex flex-wrap gap-md">
                      <label className={labelClass}>
                        Word cap (first email)
                        <input
                          type="number"
                          min={30}
                          max={400}
                          className={`${fieldClass} w-28`}
                          value={preset.max_words}
                          onChange={(event) => updatePreset(index, { max_words: Number(event.target.value) || 0 })}
                        />
                      </label>
                      <label className={labelClass}>
                        Proof points
                        <input
                          type="number"
                          min={0}
                          max={5}
                          className={`${fieldClass} w-20`}
                          value={preset.proof_points}
                          onChange={(event) => updatePreset(index, { proof_points: Number(event.target.value) || 0 })}
                        />
                      </label>
                      <label className={labelClass}>
                        Call to action
                        <select
                          className={fieldClass}
                          value={preset.cta}
                          onChange={(event) => updatePreset(index, { cta: event.target.value as CtaKind })}
                        >
                          {(Object.keys(CTA_LABEL) as CtaKind[]).map((cta) => (
                            <option key={cta} value={cta}>
                              {CTA_LABEL[cta]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                  <div className="grid gap-sm">
                    <label className={labelClass}>
                      Example email
                      <textarea
                        className={`${fieldClass} min-h-[260px] resize-y font-mono`}
                        value={preset.example}
                        maxLength={4000}
                        onChange={(event) => updatePreset(index, { example: event.target.value })}
                      />
                    </label>
                    <div className="flex flex-wrap items-center gap-sm text-body-sm text-muted">
                      <span className="font-mono">id: {preset.id}</span>
                      {preset.id === DEFAULT_PRESET_ID ? <span>· the default style</span> : null}
                      <button
                        type="button"
                        className={`${smallButton} ml-auto`}
                        onClick={() => removePreset(index)}
                        disabled={inUse || styles.presets.length <= 1}
                        title={inUse ? "In use above. Choose another style there first." : undefined}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="border-t border-border px-lg py-md">
          <button type="button" className={smallButton} onClick={addPreset} disabled={styles.presets.length >= 20}>
            Add style
          </button>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-sm">
        <button
          type="button"
          onClick={onSave}
          disabled={pending || !dirty}
          className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={restoreDefaults}
          disabled={pending}
          className="rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40"
        >
          Restore defaults
        </button>
        {message ? (
          <p role={message.kind === "error" ? "alert" : "status"} className={`text-body-sm ${message.kind === "error" ? "text-error" : "text-success"}`}>
            {message.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
