"use client";

import { useState } from "react";
import { saveMaterialFields } from "@/app/admin/agent-actions";
import { setAdminFlash, useAdminFlash } from "@/lib/admin-flash";
import {
  MATERIAL_FIELDS_MAX,
  MATERIAL_FIELD_TYPES,
  fieldIdFromLabel,
  type MaterialField,
  type MaterialFieldType,
} from "@/lib/material-fields";

const fieldClass =
  "mt-sm w-full rounded-md border border-border bg-background px-sm py-sm font-sans text-body-sm normal-case tracking-normal text-body outline-none focus:border-primary";
const labelClass = "block text-label uppercase tracking-label text-muted";
const smallButton =
  "rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

const FLASH_KEY = "material-fields";

/** How the field looks to the client, so the admin sees the result. */
function FieldPreview({ field }: { field: MaterialField }) {
  const previewClass =
    "mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body";
  return (
    <div className="rounded-md border border-dashed border-border bg-surface p-md">
      <p className="mb-sm text-label uppercase tracking-label text-muted">Client sees</p>
      <p className={labelClass}>
        {field.label || "Untitled field"}
        {field.required ? <span className="text-error"> *</span> : null}
      </p>
      {field.help ? <p className="mt-xs text-body-sm text-muted">{field.help}</p> : null}
      {field.type === "textarea" ? (
        <textarea
          className={`${previewClass} resize-none`}
          rows={3}
          placeholder={field.placeholder || undefined}
          readOnly
          tabIndex={-1}
          aria-hidden
        />
      ) : (
        <input
          className={previewClass}
          placeholder={field.placeholder || (field.type === "url" ? "https://" : undefined)}
          readOnly
          tabIndex={-1}
          aria-hidden
        />
      )}
    </div>
  );
}

export function MaterialFieldsEditor({
  initialFields,
  defaultFields,
}: {
  initialFields: MaterialField[];
  defaultFields: MaterialField[];
}) {
  const [fields, setFields] = useState<MaterialField[]>(initialFields);
  const [pending, setPending] = useState(false);
  const flash = useAdminFlash(FLASH_KEY);

  function updateField(index: number, patch: Partial<MaterialField>) {
    setFields((current) =>
      current.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    );
  }

  function moveField(index: number, direction: -1 | 1) {
    setFields((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function addField() {
    setFields((current) => {
      const taken = new Set(current.map((field) => field.id));
      return [
        ...current,
        {
          id: fieldIdFromLabel(`field ${current.length + 1}`, taken),
          label: "",
          help: "",
          placeholder: "",
          type: "textarea",
          required: false,
        },
      ];
    });
  }

  function restoreDefaults() {
    if (
      !window.confirm(
        "Replace the fields with the defaults? Nothing is saved until you click Save.",
      )
    ) {
      return;
    }
    setFields(defaultFields);
    setAdminFlash(FLASH_KEY, { kind: "ok", text: "Defaults restored. Click Save to keep them." });
  }

  async function onSave() {
    setPending(true);
    setAdminFlash(FLASH_KEY, null);
    try {
      const result = await saveMaterialFields(fields);
      setAdminFlash(
        FLASH_KEY,
        result.ok ? { kind: "ok", text: "Saved." } : { kind: "error", text: result.error },
      );
    } catch (err) {
      setAdminFlash(FLASH_KEY, {
        kind: "error",
        text: err instanceof Error ? err.message : "Unable to save.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-lg">
      <section className="rounded-card border border-border bg-surface">
        <div className="border-b border-border px-lg py-lg">
          <h2 className="text-h4">Fields</h2>
          <p className="mt-xs text-body-sm text-muted">
            In order, as the client sees them. The deck upload always comes first.
          </p>
        </div>
        <ol>
          {fields.map((field, index) => (
            <li key={field.id} className="border-b border-border px-lg py-md last:border-b-0">
              <div className="flex flex-wrap items-start gap-md">
                <span className="mt-sm w-6 shrink-0 font-mono text-mono text-muted">
                  {index + 1}
                </span>
                <div className="grid min-w-0 flex-1 gap-md lg:grid-cols-2">
                  <div className="grid gap-sm">
                    <label className={labelClass}>
                      Label
                      <input
                        className={fieldClass}
                        value={field.label}
                        maxLength={80}
                        onChange={(event) => updateField(index, { label: event.target.value })}
                      />
                    </label>
                    <label className={labelClass}>
                      Helper text (under the label)
                      <textarea
                        className={`${fieldClass} min-h-[64px] resize-y`}
                        value={field.help}
                        maxLength={400}
                        onChange={(event) => updateField(index, { help: event.target.value })}
                      />
                    </label>
                    <label className={labelClass}>
                      Grey example text (inside the empty field)
                      <input
                        className={fieldClass}
                        value={field.placeholder}
                        maxLength={300}
                        onChange={(event) =>
                          updateField(index, { placeholder: event.target.value })
                        }
                      />
                    </label>
                    <div className="flex flex-wrap items-end gap-md">
                      <label className={labelClass}>
                        Type
                        <select
                          className={fieldClass}
                          value={field.type}
                          onChange={(event) =>
                            updateField(index, {
                              type: event.target.value as MaterialFieldType,
                            })
                          }
                        >
                          {MATERIAL_FIELD_TYPES.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="mb-sm inline-flex items-center gap-sm text-body-sm text-secondary">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(event) =>
                            updateField(index, { required: event.target.checked })
                          }
                          className="h-4 w-4 accent-primary"
                        />
                        Required
                      </label>
                    </div>
                  </div>
                  <FieldPreview field={field} />
                </div>
                <div className="flex shrink-0 flex-col gap-xs">
                  <button
                    type="button"
                    className={smallButton}
                    onClick={() => moveField(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${field.label || "field"} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={smallButton}
                    onClick={() => moveField(index, 1)}
                    disabled={index === fields.length - 1}
                    aria-label={`Move ${field.label || "field"} down`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={smallButton}
                    onClick={() =>
                      setFields((current) => current.filter((_, i) => i !== index))
                    }
                    disabled={fields.length <= 1}
                    aria-label={`Remove ${field.label || "field"}`}
                  >
                    ✕
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ol>
        <div className="border-t border-border px-lg py-md">
          <button
            type="button"
            className={smallButton}
            onClick={addField}
            disabled={fields.length >= MATERIAL_FIELDS_MAX}
          >
            Add field
          </button>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-sm">
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
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
        {flash?.kind === "ok" ? <p className="text-body-sm text-success">{flash.text}</p> : null}
        {flash?.kind === "error" ? (
          <p role="alert" className="text-body-sm text-error">
            {flash.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
