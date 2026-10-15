"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buildMatchProfile, saveCompanyProfile } from "@/app/admin/match-actions";
import { FieldInput, type Taxonomy } from "@/app/admin/clients/[id]/profile/profile-fields";
import {
  labelClass,
  primaryButton,
  secondaryButton,
  smallButton,
} from "@/app/admin/clients/[id]/match/ui";
import { formatDateAtTime } from "@/lib/format";
import {
  MATCH_FIELDS,
  MATCH_SECTIONS,
  NONE_OK_FIELDS,
  firmTypeLabel,
  isListField,
  type MatchAnswers,
  type MatchField,
  type MatchProfileState,
} from "@/lib/match/shared";

/** What an empty field means, so a blank never reads as "missing". */
const EMPTY_MEANS: Record<string, string> = {
  instrument: "Equity (default)",
  core_industry: "Derived from the verticals",
  investor_types: "Set from the stage",
};

const WIDE_KINDS = new Set(["textarea", "verticals", "industries", "markets"]);

function display(field: MatchField, value: string | string[] | undefined) {
  if (Array.isArray(value) && value.length > 0) {
    return field.kind === "investor_types" ? value.map(firmTypeLabel).join(", ") : value.join(", ");
  }
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

function fieldsOf(section: string, answers: MatchAnswers) {
  const isUs = answers.hq_country === "United States";
  return MATCH_FIELDS.filter((field) => field.section === section).filter(
    (field) => field.kind !== "state" || isUs,
  );
}

function SectionPanel({
  clientId,
  section,
  answers,
  taxonomy,
  editing,
  blocking,
  locked,
  onEdit,
  onCancel,
  onSaved,
}: {
  clientId: string;
  section: string;
  answers: MatchAnswers;
  taxonomy: Taxonomy;
  editing: boolean;
  blocking: Set<string>;
  locked: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSaved: (state: MatchProfileState) => void;
}) {
  const [draft, setDraft] = useState<MatchAnswers>(answers);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = fieldsOf(section, editing ? draft : answers);

  // Each edit starts from the saved answers.
  useEffect(() => {
    if (!editing) return;
    setDraft(answers);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when editing starts
  }, [editing]);
  const needs = fields.filter((field) => blocking.has(field.id));

  function set(id: string, value: string | string[]) {
    setDraft((current) => {
      const next = { ...current };
      const empty = Array.isArray(value) ? value.length === 0 : !value;
      if (empty) delete next[id];
      else next[id] = value;
      return next;
    });
  }

  async function save() {
    setPending(true);
    setError(null);
    try {
      const result = await saveCompanyProfile(clientId, draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved(result.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      id={`profile-${section}`}
      className={`scroll-mt-lg rounded-card border bg-surface ${
        needs.length > 0 ? "border-warning/40" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-sm border-b border-border px-lg py-md">
        <h2 className="text-h4 text-heading">{section}</h2>
        {editing ? null : (
          <button
            type="button"
            className={smallButton}
            disabled={locked}
            onClick={onEdit}
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="grid gap-md px-lg py-md md:grid-cols-2">
          {fields.map((field) => (
            <div key={field.id} className={WIDE_KINDS.has(field.kind) ? "md:col-span-2" : ""}>
              <div className="flex items-center justify-between gap-sm">
                {isListField(field) ? (
                  <p className={labelClass}>{field.label}</p>
                ) : (
                  <label htmlFor={`match-${field.id}`} className={labelClass}>
                    {field.label}
                  </label>
                )}
                {NONE_OK_FIELDS.has(field.id) && !draft[field.id] ? (
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
                value={draft[field.id]}
                taxonomy={taxonomy}
                onChange={(value) => set(field.id, value)}
              />
              {field.hint ? <p className="mt-xs text-body-sm text-muted">{field.hint}</p> : null}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-sm md:col-span-2">
            <button type="button" className={primaryButton} disabled={pending} onClick={() => void save()}>
              {pending ? "Saving…" : "Save"}
            </button>
            <button type="button" className={secondaryButton} disabled={pending} onClick={onCancel}>
              Cancel
            </button>
            {error ? (
              <p role="alert" className="text-body-sm text-error">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <dl className="divide-y divide-border">
          {fields.map((field) => {
            const shown = display(field, answers[field.id]);
            const fallback = NONE_OK_FIELDS.has(field.id) ? "None" : EMPTY_MEANS[field.id];
            return (
              <div key={field.id} className="grid gap-xs px-lg py-sm sm:grid-cols-[minmax(0,11rem)_1fr] sm:gap-md">
                <dt className="text-body-sm text-muted">{field.label}</dt>
                <dd
                  className={`whitespace-pre-wrap text-body-sm ${
                    shown ? "text-heading" : blocking.has(field.id) ? "text-warning" : "text-muted"
                  }`}
                >
                  {shown ?? (blocking.has(field.id) ? "Needed for matching" : fallback ?? "Not provided")}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}

/**
 * The company profile by topic: the source of truth for matching, the
 * materials analysis and the outreach narrative. Each panel edits on its own.
 */
export function ProfileWorkspace({
  clientId,
  initialState,
  taxonomy,
  canBuildFromIntake,
}: {
  clientId: string;
  initialState: MatchProfileState | null;
  taxonomy: Taxonomy;
  canBuildFromIntake: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [editing, setEditing] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const answers = state?.answers ?? {};
  const blocking = new Set((state?.gaps ?? []).map((gap) => gap.id));

  async function rebuild() {
    if (
      state?.editedAt &&
      !window.confirm("Rebuild the profile from the intake? Your edits to it will be replaced.")
    ) {
      return;
    }
    setBuilding(true);
    setNotice(null);
    setEditing(null);
    try {
      const result = await buildMatchProfile(clientId);
      if (!result.ok) {
        setNotice({ kind: "error", text: result.error });
        return;
      }
      setState(result.state);
      setNotice({ kind: "ok", text: "Rebuilt from the intake." });
      router.refresh();
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "The profile could not be built.",
      });
    } finally {
      setBuilding(false);
    }
  }

  function goToSection(fieldId: string) {
    const section = MATCH_FIELDS.find((field) => field.id === fieldId)?.section;
    if (!section) return;
    setEditing(section);
    document.getElementById(`profile-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const status = building
    ? { label: "Building…", tone: "text-muted border-border" }
    : !state
      ? { label: "Not built yet", tone: "text-muted border-border" }
      : state.status === "ready"
        ? { label: "Ready to match", tone: "text-success border-success/40" }
        : { label: "Needs info", tone: "text-warning border-warning/40" };

  return (
    <div className="space-y-lg">
      <section className="flex flex-wrap items-center justify-between gap-md rounded-card border border-border bg-surface px-lg py-md">
        <div className="min-w-0">
          <span className={`rounded-full border px-sm py-px text-label uppercase tracking-label ${status.tone}`}>
            {status.label}
          </span>
          <p className="mt-xs text-body-sm text-muted">
            {state?.builtAt
              ? `Built from the intake ${formatDateAtTime(state.builtAt)}${
                  state.editedAt ? `, edited ${formatDateAtTime(state.editedAt)}` : ""
                }.`
              : "Built from the intake, editable here. Matching, the analysis and the narrative read it."}
          </p>
        </div>
        <div className="flex flex-wrap gap-sm">
          {canBuildFromIntake ? (
            <button type="button" className={secondaryButton} disabled={building} onClick={() => void rebuild()}>
              {building ? "Building…" : state?.builtAt ? "Rebuild from intake" : "Build from intake"}
            </button>
          ) : null}
          <Link href={`/admin/clients/${clientId}/match`} className={`${primaryButton} no-underline`}>
            Open Rupert Match
          </Link>
        </div>
      </section>

      {notice ? (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={`text-body-sm ${notice.kind === "error" ? "text-error" : "text-success"}`}
        >
          {notice.text}
        </p>
      ) : null}

      {state && state.gaps.length > 0 ? (
        <p className="rounded-card border border-warning/40 bg-surface px-lg py-md text-body-sm text-warning">
          <span className="text-heading">Matching needs: </span>
          {state.gaps.map((gap, index) => (
            <span key={gap.id}>
              {index > 0 ? ", " : ""}
              <button type="button" className="underline hover:text-primary" onClick={() => goToSection(gap.id)}>
                {gap.label}
              </button>
            </span>
          ))}
          . Everything else is optional: empty answers count as &ldquo;none&rdquo;.
        </p>
      ) : null}

      {state && state.warnings.length > 0 ? (
        <ul className="space-y-xs rounded-card border border-border bg-surface px-lg py-md text-body-sm text-secondary">
          {state.warnings.map((warning) => (
            <li key={warning}>⚑ {warning}</li>
          ))}
        </ul>
      ) : null}

      <div className="grid items-start gap-lg lg:grid-cols-2">
        {MATCH_SECTIONS.map((section) => (
          <SectionPanel
            key={section}
            clientId={clientId}
            section={section}
            answers={answers}
            taxonomy={taxonomy}
            editing={editing === section}
            blocking={blocking}
            locked={building || (editing !== null && editing !== section)}
            onEdit={() => setEditing(section)}
            onCancel={() => setEditing(null)}
            onSaved={(next) => {
              setState(next);
              setEditing(null);
              setNotice({ kind: "ok", text: `${section} saved.` });
            }}
          />
        ))}
      </div>
    </div>
  );
}
