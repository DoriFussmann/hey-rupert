"use client";

import { useState, type ReactNode } from "react";
import { QuestionThread } from "@/components/setup/question-thread";
import { ReviewActions } from "@/components/setup/review-actions";
import { WithFields } from "@/app/portal/setup/email-copy/typed-copy-review";
import { NOTE_MAX, type SetupQuestion } from "@/lib/setup";
import {
  BUCKET_DETAIL,
  BUCKET_LABEL,
  HOOK_FIELD,
  SOURCE_SEQUENCE_LABELS,
  sourceGroupKey,
  type SourceCopy,
} from "@/lib/outreach/source-copy";

const tabClass = (active: boolean) =>
  `rounded-md px-md py-sm text-body-sm transition-colors duration-hover ${
    active ? "bg-primary text-white" : "border border-border bg-surface text-secondary hover:text-heading"
  }`;

/** The client's view of copy by source: one tab per group, two emails each, a note per group. */
export function SourceCopyReview({
  copy,
  version,
  open,
  sentNotes,
  adminNote,
  questions = [],
  readOnly,
}: {
  copy: SourceCopy;
  version: number;
  open: boolean;
  sentNotes: Record<string, string>;
  adminNote?: ReactNode;
  questions?: SetupQuestion[];
  readOnly: boolean;
}) {
  const [active, setActive] = useState(0);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const index = Math.min(active, Math.max(copy.groups.length - 1, 0));
  const group = copy.groups[index];
  const key = group ? sourceGroupKey(group.bucket) : "";

  return (
    <>
      {adminNote}
      <div className="mb-md flex flex-wrap gap-sm" role="tablist" aria-label="Email group">
        {copy.groups.map((entry, i) => (
          <button
            key={entry.bucket}
            type="button"
            role="tab"
            aria-selected={i === index}
            className={tabClass(i === index)}
            onClick={() => setActive(i)}
          >
            {BUCKET_LABEL[entry.bucket]} · {entry.funds} funds
            {notes[sourceGroupKey(entry.bucket)]?.trim() ? " •" : ""}
          </button>
        ))}
      </div>

      {group ? (
        <section className="rounded-card border border-border bg-surface">
          <div className="border-b border-border px-lg py-md">
            <h2 className="text-h4">{BUCKET_LABEL[group.bucket]}</h2>
            <p className="mt-xs text-body-sm text-secondary">
              {BUCKET_DETAIL[group.bucket]} {group.funds} funds, {group.contacts} investors.
            </p>
            {group.examples?.length ? (
              <p className="mt-xs text-body-sm text-muted">
                <WithFields text={`{{${HOOK_FIELD[group.bucket]}}}`} /> is filled in for each fund, for example:{" "}
                {group.examples.slice(0, 3).join(", ")}.
              </p>
            ) : null}
          </div>
          <ol className="divide-y divide-border">
            {group.emails.map((email, position) => (
              <li key={position} className="px-lg py-lg">
                <p className="text-label uppercase tracking-label text-muted">{SOURCE_SEQUENCE_LABELS[position]}</p>
                <p className="mt-sm text-body-sm text-heading">
                  <span className="text-muted">Subject: </span>
                  {email.subject.trim() ? <WithFields text={email.subject} /> : position > 0 ? "(same thread)" : "—"}
                </p>
                <div className="mt-sm whitespace-pre-wrap rounded-md bg-background px-md py-md font-sans text-body-sm text-body">
                  <WithFields text={email.body} />
                  {position === 0 && copy.opt_out_line ? `\n\n${copy.opt_out_line}` : ""}
                </div>
              </li>
            ))}
          </ol>

          {sentNotes[key] ? (
            <p className="mx-lg mb-md rounded-md bg-background px-sm py-xs text-body-sm text-secondary">
              <span className="text-heading">Your note:</span> {sentNotes[key]}
            </p>
          ) : null}

          {open ? (
            <div className="border-t border-border px-lg py-md">
              <label className="block text-label uppercase tracking-label text-muted">
                Note on these emails (optional)
                <textarea
                  className="mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm normal-case tracking-normal text-body outline-none focus:border-primary"
                  rows={3}
                  maxLength={NOTE_MAX}
                  value={notes[key] ?? ""}
                  disabled={readOnly}
                  onChange={(event) => setNotes((existing) => ({ ...existing, [key]: event.target.value }))}
                  placeholder="Wording to change, claims to soften, anything for this group"
                />
              </label>
            </div>
          ) : null}
        </section>
      ) : null}

      <QuestionThread questions={questions} />
      {open ? (
        <ReviewActions
          step="email_copy"
          version={version}
          itemNotes={notes}
          confirmLabel="Confirm Emails"
          itemNotesLabel="on the email groups"
          intro="Confirm the emails to move forward, ask Rupert a question, or request changes."
          readOnly={readOnly}
        />
      ) : null}
    </>
  );
}
