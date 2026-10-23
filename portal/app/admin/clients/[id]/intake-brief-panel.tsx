"use client";

import { useState } from "react";
import { generateIntakeBrief, updateIntakeBrief } from "@/app/admin/agent-actions";
import { MarkdownBody } from "@/components/markdown-body";
import { formatDateAtTime } from "@/lib/format";
import { INTAKE_BRIEF_FIELDS, type IntakeBrief } from "@/lib/intake";

const inputClass =
  "mt-xs w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm normal-case tracking-normal text-body outline-none focus:border-primary";
const labelClass = "block text-label uppercase tracking-label text-muted";
const smallButton =
  "rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

type Editable = Pick<IntakeBrief, "summary" | "industry" | "geography" | "stage" | "raise_amount">;

function editable(brief: IntakeBrief): Editable {
  return {
    summary: brief.summary,
    industry: brief.industry,
    geography: brief.geography,
    stage: brief.stage,
    raise_amount: brief.raise_amount,
  };
}

/**
 * The intake at a glance: an AI-written brief plus industry, geography,
 * stage and raise. Written by Analyze on the client page (or Write summary
 * here), never on page load; editable and regenerable.
 */
export function IntakeBriefPanel({
  clientId,
  initialBrief,
  interviewUpdatedAt,
  hasInterview,
  claudeReady,
  completedAt,
}: {
  clientId: string;
  initialBrief: IntakeBrief | null;
  interviewUpdatedAt: string | null;
  hasInterview: boolean;
  claudeReady: boolean;
  completedAt: string | null;
}) {
  const [brief, setBrief] = useState(initialBrief);
  const [form, setForm] = useState<Editable | null>(null);
  const [pending, setPending] = useState<null | "generate" | "save">(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setPending("generate");
    setError(null);
    try {
      const result = await generateIntakeBrief(clientId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBrief(result.brief);
      setForm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to write the summary.");
    } finally {
      setPending(null);
    }
  }

  async function onRegenerate() {
    if (
      brief?.edited_at &&
      !window.confirm("Regenerate the summary? Your edits to it will be replaced.")
    ) {
      return;
    }
    await generate();
  }

  async function onSave() {
    if (!form) return;
    setPending("save");
    setError(null);
    try {
      const result = await updateIntakeBrief(clientId, form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBrief(result.brief);
      setForm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save.");
    } finally {
      setPending(null);
    }
  }

  const stale = Boolean(
    brief && interviewUpdatedAt && brief.based_on && interviewUpdatedAt > brief.based_on,
  );

  return (
    <section className="mb-lg rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-md border-b border-border px-lg py-lg">
        <div>
          <h2 className="text-h4">Overview</h2>
          <p className="mt-xs text-body-sm text-muted">
            {completedAt ? `Intake completed ${formatDateAtTime(completedAt)}. ` : ""}
            {brief
              ? `${brief.edited_at ? `Edited ${formatDateAtTime(brief.edited_at)}` : `Written ${formatDateAtTime(brief.generated_at)}`}. Empty profile fields were filled from it.`
              : "A summary of the intake, written by the AI."}
          </p>
        </div>
        {hasInterview ? (
          <div className="flex flex-wrap gap-sm">
            {brief && !form ? (
              <button
                type="button"
                className={smallButton}
                disabled={pending !== null}
                onClick={() => setForm(editable(brief))}
              >
                Edit
              </button>
            ) : null}
            <button
              type="button"
              className={smallButton}
              disabled={pending !== null || !claudeReady || Boolean(form)}
              onClick={brief ? onRegenerate : generate}
            >
              {pending === "generate" ? "Writing…" : brief ? "Regenerate" : "Write summary"}
            </button>
          </div>
        ) : null}
      </div>

      {stale && !form ? (
        <p className="border-b border-border bg-background px-lg py-sm text-body-sm text-warning">
          The client added more to the intake after this summary. Regenerate to include it.
        </p>
      ) : null}

      {!hasInterview ? (
        <p className="px-lg py-md text-body-sm text-muted">
          No intake interview on record for this client.
        </p>
      ) : pending === "generate" && !brief ? (
        <p className="px-lg py-md text-body-sm text-muted" aria-live="polite">
          Writing the summary from the intake… this takes a few seconds.
        </p>
      ) : form ? (
        <div className="grid gap-md px-lg py-md">
          <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-4">
            {INTAKE_BRIEF_FIELDS.map((field) => (
              <label key={field.key} className={labelClass}>
                {field.label}
                <input
                  className={inputClass}
                  value={form[field.key]}
                  maxLength={200}
                  onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
                />
              </label>
            ))}
          </div>
          <label className={labelClass}>
            Summary (markdown)
            <textarea
              className={`${inputClass} min-h-[280px] resize-y`}
              value={form.summary}
              maxLength={20000}
              onChange={(event) => setForm({ ...form, summary: event.target.value })}
            />
          </label>
          <div className="flex flex-wrap gap-sm">
            <button
              type="button"
              className="rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
              disabled={pending !== null}
              onClick={onSave}
            >
              {pending === "save" ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className={smallButton}
              disabled={pending !== null}
              onClick={() => setForm(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : brief ? (
        <div className="px-lg py-md">
          <MarkdownBody content={brief.summary} emptyLabel="Empty." />
        </div>
      ) : (
        <p className="px-lg py-md text-body-sm text-muted">
          {claudeReady
            ? "No summary yet."
            : "Claude is not configured (ANTHROPIC_API_KEY), so the summary can't be written."}
        </p>
      )}

      {error ? (
        <p role="alert" className="px-lg pb-md text-body-sm text-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
