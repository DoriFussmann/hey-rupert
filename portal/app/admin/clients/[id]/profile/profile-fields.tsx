"use client";

// Inputs for the company profile fields: shared by the profile topic panels.
import { inputClass } from "@/app/admin/clients/[id]/match/ui";
import {
  BUSINESS_MODELS,
  FIRM_TYPES,
  MARKETS,
  US_STATES,
  firmTypeLabel,
  type MatchField,
} from "@/lib/match/shared";

export type Taxonomy = {
  stages: string[];
  verticals: string[];
  industries: string[];
  countries: string[];
};

const chipClass =
  "inline-flex items-center gap-xs rounded-full border border-border bg-background px-sm py-xs text-body-sm text-heading";

function ChipList({
  inputId,
  label,
  value,
  options,
  max,
  ranked,
  onChange,
}: {
  inputId: string;
  label: string;
  value: string[];
  options: string[];
  max: number;
  ranked: boolean;
  onChange: (next: string[]) => void;
}) {
  const remaining = options.filter((option) => !value.includes(option));
  return (
    <div>
      <div className="mt-sm flex flex-wrap gap-xs">
        {value.map((item, index) => (
          <span key={item} className={`${chipClass} ${ranked && index === 0 ? "border-primary text-primary" : ""}`}>
            {ranked && index === 0 ? <span aria-label="core">★</span> : null}
            {item}
            {ranked && index > 0 ? (
              <button
                type="button"
                className="text-muted hover:text-primary"
                aria-label={`Make ${item} the core`}
                title="Make core"
                onClick={() => onChange([item, ...value.filter((entry) => entry !== item)])}
              >
                ↑
              </button>
            ) : null}
            <button
              type="button"
              className="text-muted hover:text-error"
              aria-label={`Remove ${item}`}
              onClick={() => onChange(value.filter((entry) => entry !== item))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      {value.length < max ? (
        <select
          id={inputId}
          aria-label={`Add to ${label}`}
          className={`${inputClass} mt-xs`}
          value=""
          onChange={(event) => {
            if (event.target.value) onChange([...value, event.target.value]);
          }}
        >
          <option value="">+ Add</option>
          {remaining.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

export function FieldInput({
  field,
  value,
  taxonomy,
  onChange,
}: {
  field: MatchField;
  value: string | string[] | undefined;
  taxonomy: Taxonomy;
  onChange: (next: string | string[]) => void;
}) {
  const text = typeof value === "string" ? value : "";
  const list = Array.isArray(value) ? value : [];
  const id = `match-${field.id}`;
  const select = (options: string[], labels?: (option: string) => string) => (
    <select id={id} className={`${inputClass} mt-xs`} value={text} onChange={(event) => onChange(event.target.value)}>
      <option value="">Not set</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {labels ? labels(option) : option}
        </option>
      ))}
    </select>
  );

  switch (field.kind) {
    case "textarea":
      return (
        <textarea
          id={id}
          rows={2}
          className={`${inputClass} mt-xs`}
          value={text}
          maxLength={2000}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "stage":
      return select(taxonomy.stages);
    case "model":
      return select(BUSINESS_MODELS);
    case "lead":
      return select(["Yes", "No"], (option) => (option === "Yes" ? "Yes, needs a lead" : "No"));
    case "country":
      return select(taxonomy.countries);
    case "state":
      return select(US_STATES);
    case "verticals":
      return <ChipList inputId={id} label={field.label} value={list} options={taxonomy.verticals} max={3} ranked onChange={onChange} />;
    case "industries":
      return <ChipList inputId={id} label={field.label} value={list} options={taxonomy.industries} max={3} ranked onChange={onChange} />;
    case "markets":
      return <ChipList inputId={id} label={field.label} value={list} options={MARKETS} max={MARKETS.length} ranked={false} onChange={onChange} />;
    case "investor_types":
      return (
        <div id={id} tabIndex={-1} className="mt-xs flex flex-wrap gap-sm">
          {FIRM_TYPES.map((type) => (
            <label key={type} className="inline-flex items-center gap-xs text-body-sm text-body">
              <input
                type="checkbox"
                checked={list.includes(type)}
                onChange={(event) =>
                  onChange(event.target.checked ? [...list, type] : list.filter((item) => item !== type))
                }
              />
              {firmTypeLabel(type)}
            </label>
          ))}
        </div>
      );
    default:
      return (
        <input
          id={id}
          className={`${inputClass} mt-xs`}
          value={text}
          maxLength={2000}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}
