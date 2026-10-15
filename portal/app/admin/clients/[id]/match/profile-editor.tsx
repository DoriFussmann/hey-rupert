"use client";

import { useState } from "react";
import { buildMatchProfile, saveMatchProfile } from "@/app/admin/match-actions";
import {
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
  type RunAction,
} from "@/app/admin/clients/[id]/match/ui";
import { formatDateAtTime } from "@/lib/format";
import {
  BUSINESS_MODELS,
  FIRM_TYPES,
  MARKETS,
  MATCH_FIELDS,
  MATCH_SECTIONS,
  NONE_OK_FIELDS,
  US_STATES,
  firmTypeLabel,
  isListField,
  type MatchAnswers,
  type MatchField,
  type MatchProfileState,
  type MatchView,
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

function FieldInput({
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

export function ProfileEditor({
  clientId,
  companyName,
  state,
  taxonomy,
  canBuildFromIntake,
  busy,
  run,
  onSaved,
  onBuilt,
}: {
  clientId: string;
  companyName: string;
  state: MatchProfileState | null;
  taxonomy: Taxonomy;
  canBuildFromIntake: boolean;
  busy: boolean;
  run: RunAction;
  onSaved: (state: MatchProfileState, view: MatchView | null, runError: string | null) => void;
  onBuilt: (state: MatchProfileState, view: MatchView | null, runError: string | null) => void;
}) {
  const [answers, setAnswers] = useState<MatchAnswers>(
    state?.answers ?? { company_name: companyName },
  );
  const [open, setOpen] = useState(!state || state.status !== "ready");
  const [savedKey, setSavedKey] = useState(JSON.stringify(state?.answers ?? null));
  const dirty = JSON.stringify(answers) !== savedKey;
  const isUs = answers.hq_country === "United States";

  function set(id: string, value: string | string[]) {
    setAnswers((current) => {
      const next = { ...current };
      const empty = Array.isArray(value) ? value.length === 0 : !value;
      if (empty) delete next[id];
      else next[id] = value;
      return next;
    });
  }

  function save() {
    void run("Saving the profile and running the match…", () => saveMatchProfile(clientId, answers), (result) => {
      setAnswers(result.state.answers);
      setSavedKey(JSON.stringify(result.state.answers));
      onSaved(result.state, result.view, result.runError);
    });
  }

  function build() {
    if (
      state?.editedAt &&
      !window.confirm("Rebuild the profile from the intake? Your edits to it will be replaced.")
    ) {
      return;
    }
    void run(
      "Reading the intake, building the profile and running the match…",
      () => buildMatchProfile(clientId, { run: true }),
      (result) => {
        setAnswers(result.state.answers);
        setSavedKey(JSON.stringify(result.state.answers));
        setOpen(result.state.status !== "ready");
        onBuilt(result.state, result.view, result.runError);
      },
    );
  }

  /** Opens the form and puts the cursor in the field that needs an answer. */
  function goTo(fieldId: string) {
    setOpen(true);
    if (fieldId === "hq_state" && !isUs) fieldId = "hq_country";
    // Wait for the form to render when it was closed.
    window.setTimeout(() => {
      const element = document.getElementById(`match-${fieldId}`);
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
      element?.focus({ preventScroll: true });
    }, 50);
  }

  const status = !state
    ? { label: "Not built yet", tone: "text-muted border-border" }
    : state.status === "ready"
      ? { label: "Ready to match", tone: "text-success border-success/40" }
      : { label: "Needs info", tone: "text-warning border-warning/40" };
  const missing = state?.gaps.filter((gap) => gap.kind === "missing") ?? [];
  const unasked = state?.gaps.filter((gap) => gap.kind === "unasked") ?? [];

  return (
    <section className="rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-md px-lg py-md">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-sm">
            <h2 className="text-h4 text-heading">Company profile</h2>
            <span className={`rounded-full border px-sm py-px text-label uppercase tracking-label ${status.tone}`}>
              {status.label}
            </span>
          </div>
          <p className="mt-xs text-body-sm text-muted">
            {state?.builtAt
              ? `Built from the intake ${formatDateAtTime(state.builtAt)}${state.editedAt ? `, edited ${formatDateAtTime(state.editedAt)}` : ""}.`
              : "What matching knows about the company. Built from the intake, editable here."}
          </p>
        </div>
        <div className="flex flex-wrap gap-sm">
          {canBuildFromIntake ? (
            <button type="button" className={secondaryButton} disabled={busy} onClick={build}>
              {state?.builtAt ? "Rebuild from intake" : "Build from intake"}
            </button>
          ) : null}
          <button
            type="button"
            className={secondaryButton}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Hide profile" : "Edit profile"}
          </button>
        </div>
      </div>

      {missing.length > 0 || unasked.length > 0 || (state?.warnings.length ?? 0) > 0 ? (
        <div className="space-y-sm border-t border-border px-lg py-md text-body-sm">
          {missing.length > 0 || unasked.length > 0 ? (
            <p className="text-secondary">
              The intake didn&apos;t cover these. Answer them yourself (from your notes, or ask the founder),
              then click <span className="text-heading">Save and run match</span>. Nothing needs approving and
              nothing goes to the client. The match already runs; these answers make it more precise.
            </p>
          ) : null}
          {missing.length > 0 ? (
            <p className="text-warning">
              <span className="text-heading">Missing:</span>{" "}
              {missing.map((gap, index) => (
                <span key={gap.id}>
                  {index > 0 ? ", " : ""}
                  <button type="button" className="underline hover:text-primary" onClick={() => goTo(gap.id)}>
                    {gap.label}
                  </button>
                </span>
              ))}
            </p>
          ) : null}
          {unasked.length > 0 ? (
            <p className="text-warning">
              <span className="text-heading">Not asked yet (&ldquo;none&rdquo; counts as an answer):</span>{" "}
              {unasked.map((gap, index) => (
                <span key={gap.id}>
                  {index > 0 ? ", " : ""}
                  <button type="button" className="underline hover:text-primary" onClick={() => goTo(gap.id)}>
                    {gap.label}
                  </button>
                </span>
              ))}
            </p>
          ) : null}
          {state?.warnings.map((warning) => (
            <p key={warning} className="text-secondary">
              ⚑ {warning}
            </p>
          ))}
        </div>
      ) : null}

      {open ? (
        <div className="border-t border-border px-lg py-md">
          {MATCH_SECTIONS.map((section) => (
            <fieldset key={section} className="mb-lg">
              <legend className="mb-sm text-label uppercase tracking-label text-primary">{section}</legend>
              <div className="grid gap-md md:grid-cols-2">
                {MATCH_FIELDS.filter((field) => field.section === section)
                  .filter((field) => field.kind !== "state" || isUs)
                  .map((field) => (
                    <div
                      key={field.id}
                      className={
                        field.kind === "textarea" ||
                        field.kind === "verticals" ||
                        field.kind === "industries" ||
                        field.kind === "markets"
                          ? "md:col-span-2"
                          : ""
                      }
                    >
                      <div className="flex items-center justify-between gap-sm">
                        {isListField(field) ? (
                          <p className={labelClass}>{field.label}</p>
                        ) : (
                          <label htmlFor={`match-${field.id}`} className={labelClass}>
                            {field.label}
                          </label>
                        )}
                        {NONE_OK_FIELDS.has(field.id) && !answers[field.id] ? (
                          <button
                            type="button"
                            className="text-body-sm text-primary hover:text-primary-hover"
                            onClick={() => set(field.id, "none")}
                          >
                            Set to none
                          </button>
                        ) : null}
                      </div>
                      <FieldInput
                        field={field}
                        value={answers[field.id]}
                        taxonomy={taxonomy}
                        onChange={(value) => set(field.id, value)}
                      />
                      {field.hint ? <p className="mt-xs text-body-sm text-muted">{field.hint}</p> : null}
                    </div>
                  ))}
              </div>
            </fieldset>
          ))}
          <div className="flex flex-wrap items-center gap-sm">
            <button type="button" className={primaryButton} disabled={busy} onClick={save}>
              Save and run match
            </button>
            {dirty ? <p className="text-body-sm text-warning">Unsaved changes</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
