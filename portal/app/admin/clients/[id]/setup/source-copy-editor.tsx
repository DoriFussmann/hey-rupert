"use client";

import { Fragment, useRef, useState } from "react";
import { EmailBodyField } from "@/components/email-body-field";
import { inputClass } from "@/app/admin/clients/[id]/setup/shared";
import { wordCount } from "@/lib/outreach/copy";
import { insertAt } from "@/lib/merge-fields";
import { previewFilled, type Segment } from "@/lib/outreach/preview";
import type { CopyEmail } from "@/lib/setup";
import {
  BUCKET_LABEL,
  HOOK_FIELD,
  SAMPLE_FIRST_NAMES,
  SOURCE_FIELDS,
  SOURCE_FIELD_HELP,
  SOURCE_FIELD_LABEL,
  SOURCE_MAX_WORDS,
  SOURCE_SEQUENCE_LABELS,
  groupStatus,
  sourceEmailIssues,
  sourceGroupKey,
  sourceValues,
  type GroupStatus,
  type SourceBucket,
  type SourceCopy,
  type SourceGroupCopy,
  type SourceWorkspace,
} from "@/lib/outreach/source-copy";

/** The narrative the emails are written from. */
export type CopyNarrative = {
  confirmed: boolean;
  points: { title: string; claim: string }[];
  /** Narratives from before the three points: their text. */
  text: string;
};

const tabClass = (active: boolean) =>
  `rounded-md px-md py-sm text-body-sm transition-colors duration-hover ${
    active ? "bg-primary text-white" : "border border-border bg-surface text-secondary hover:text-heading"
  }`;

const pillClass =
  "rounded-full bg-primary-tint px-sm py-px text-body-sm text-primary-hover transition-colors duration-hover hover:bg-primary hover:text-white";

const linkClass = "text-body-sm text-primary hover:text-primary-hover";

const STATUS_LABEL: Record<GroupStatus, string> = { empty: "Empty", draft: "Draft", ready: "Ready" };

const sentence = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const capFor = (position: number) => (position === 0 ? SOURCE_MAX_WORDS : Math.round(SOURCE_MAX_WORDS * 0.75));
const hasText = (group: SourceGroupCopy) => group.emails.some((email) => email.subject.trim() || email.body.trim());

function Narrative({ narrative }: { narrative: CopyNarrative }) {
  return (
    <aside
      aria-label="Narrative"
      className="mb-lg rounded-md border border-border bg-background px-md py-md lg:sticky lg:top-md lg:mb-0 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto"
    >
      <p className="text-label uppercase tracking-label text-muted">
        {narrative.confirmed ? "Approved narrative" : "Narrative · not approved yet"}
      </p>
      {narrative.points.length ? (
        <ol className="mt-sm space-y-md">
          {narrative.points.map((point, index) => (
            <li key={index} className="text-body-sm">
              <p className="text-heading">
                {index + 1}. {point.title}
              </p>
              {point.claim ? <p className="mt-xs whitespace-pre-wrap text-secondary">{point.claim}</p> : null}
            </li>
          ))}
        </ol>
      ) : narrative.text ? (
        <p className="mt-sm whitespace-pre-wrap text-body-sm text-secondary">{narrative.text}</p>
      ) : (
        <p className="mt-sm text-body-sm text-muted">No narrative yet.</p>
      )}
    </aside>
  );
}

function Segments({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.field ? (
          <mark
            key={index}
            className={`rounded-sm ${segment.missing ? "bg-transparent text-warning" : "bg-primary-tint text-heading"}`}
          >
            {segment.text}
          </mark>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}

/** Both emails of a group as one fund's investor gets them. */
function GroupPreview({
  group,
  optOutLine,
  samples,
}: {
  group: SourceGroupCopy;
  optOutLine: string;
  samples: { fund: string; hook: string }[];
}) {
  const [at, setAt] = useState(0);
  const list = samples.length ? samples : [{ fund: "Example Capital", hook: group.examples?.[0] ?? "" }];
  const sample = list[at % list.length];
  const firstName = SAMPLE_FIRST_NAMES[at % SAMPLE_FIRST_NAMES.length];
  const values = sourceValues({ name: sample.fund, bucket: group.bucket, hook: sample.hook }, firstName);

  return (
    <div className="mt-md">
      <div className="flex flex-wrap items-center gap-sm text-body-sm text-muted">
        <span>
          To <span className="text-heading">{firstName}</span> at <span className="text-heading">{sample.fund}</span>
        </span>
        {list.length > 1 ? (
          <button type="button" className={`ml-auto ${linkClass}`} onClick={() => setAt((value) => value + 1)}>
            Next fund ›
          </button>
        ) : null}
      </div>
      <ol className="mt-sm space-y-md">
        {group.emails.map((email, position) => {
          const out = previewFilled(email, values, position === 0 ? optOutLine : "");
          const subject = out.subject.map((segment) => segment.text).join("").trim();
          return (
            <li key={position} className="rounded-md border border-border bg-surface px-md py-md">
              <p className="text-label uppercase tracking-label text-muted">{SOURCE_SEQUENCE_LABELS[position]}</p>
              <p className="mt-sm text-body-sm text-heading">
                <span className="text-muted">Subject: </span>
                {subject ? <Segments segments={out.subject} /> : position > 0 ? "(same thread)" : "—"}
              </p>
              <div className="mt-sm whitespace-pre-wrap text-body-sm text-body">
                {email.body.trim() ? <Segments segments={out.body} /> : <span className="text-muted">Not written yet.</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** One email: field pills, subject, body. A pill puts its field at the cursor, in the subject or the body, whichever was used last. */
function EmailEditor({
  email,
  position,
  bucket,
  onChange,
}: {
  email: CopyEmail;
  position: number;
  bucket: SourceBucket;
  onChange: (field: "subject" | "body", value: string) => void;
}) {
  const subjectRef = useRef<HTMLInputElement>(null);
  const insertBody = useRef<((piece: string) => void) | null>(null);
  const target = useRef<"subject" | "body">("body");
  const fields = SOURCE_FIELDS[bucket];
  // A follow-up goes in the same thread: no subject, unless an older one is there to clear.
  const showSubject = position === 0 || Boolean(email.subject.trim());
  const label = `${BUCKET_LABEL[bucket]} ${SOURCE_SEQUENCE_LABELS[position]}`;
  const words = wordCount(email.body);
  const cap = capFor(position);
  // The word count has its own place; an email not started yet has nothing to fix.
  const started = Boolean(email.subject.trim() || email.body.trim());
  const issues = started ? sourceEmailIssues(email, position, bucket).filter((issue) => !/^is \d+ words/.test(issue.text)) : [];

  function insert(field: string) {
    const piece = `{{${field}}}`;
    const input = subjectRef.current;
    if (target.current === "subject" && showSubject && input) {
      const next = insertAt(email.subject, input.selectionStart ?? email.subject.length, input.selectionEnd ?? email.subject.length, piece);
      onChange("subject", next.text.slice(0, 300));
      requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(next.cursor, next.cursor);
      });
      return;
    }
    insertBody.current?.(piece);
  }

  return (
    <li>
      <div className="flex flex-wrap items-center gap-sm">
        <p className="text-label uppercase tracking-label text-muted">{SOURCE_SEQUENCE_LABELS[position]}</p>
        <span className={`ml-auto text-body-sm ${words > cap ? "text-warning" : "text-muted"}`}>
          {words} / {cap} words
        </span>
      </div>
      <div className="mt-sm flex flex-wrap items-center gap-xs">
        {fields.map((field) => (
          <button
            key={field}
            type="button"
            className={pillClass}
            title={SOURCE_FIELD_HELP[field]}
            // Keeps the cursor where it is in the email.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => insert(field)}
          >
            {SOURCE_FIELD_LABEL[field] ?? field}
          </button>
        ))}
      </div>
      {showSubject ? (
        <input
          ref={subjectRef}
          className={`${inputClass} mt-sm`}
          value={email.subject}
          maxLength={300}
          onChange={(event) => onChange("subject", event.target.value)}
          onFocus={() => (target.current = "subject")}
          placeholder="Subject"
          aria-label={`${label} subject`}
        />
      ) : null}
      <EmailBodyField
        className={inputClass}
        value={email.body}
        onChange={(value) => onChange("body", value)}
        placeholder="Body"
        label={`${label} body`}
        fields={fields}
        insertRef={insertBody}
        onFocus={() => (target.current = "body")}
      />
      {issues.length ? (
        <ul className="mt-xs text-body-sm">
          {issues.map((issue, i) => (
            <li key={i} className={issue.level === "error" ? "text-error" : "text-muted"}>
              {sentence(issue.text)}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * Rupert writes the copy by source here, by hand: the narrative beside it,
 * one tab per group, two emails each, with a preview on real funds.
 */
export function SourceCopyEditor({
  copy,
  onChange,
  clientNotes,
  narrative,
  workspace,
}: {
  copy: SourceCopy;
  onChange: (next: SourceCopy) => void;
  /** The client's notes on the last version, by group key. */
  clientNotes: Record<string, string>;
  narrative: CopyNarrative;
  /** The confirmed Plan's funds, once loaded. */
  workspace: SourceWorkspace | null;
}) {
  const [active, setActive] = useState(0);
  const [preview, setPreview] = useState(false);
  const index = Math.min(active, Math.max(copy.groups.length - 1, 0));
  const group = copy.groups[index];
  const key = group ? sourceGroupKey(group.bucket) : "";

  function updateEmail(position: number, field: "subject" | "body", value: string) {
    onChange({
      ...copy,
      groups: copy.groups.map((item, i) =>
        i === index ? { ...item, emails: item.emails.map((email, p) => (p === position ? { ...email, [field]: value } : email)) } : item,
      ),
    });
  }

  function copyFrom(source: SourceGroupCopy) {
    if (!group) return;
    if (hasText(group) && !window.confirm(`Replace the ${BUCKET_LABEL[group.bucket]} emails with a copy of ${BUCKET_LABEL[source.bucket]}?`)) return;
    onChange({
      ...copy,
      groups: copy.groups.map((item, i) => (i === index ? { ...item, emails: source.emails.map((email) => ({ ...email })) } : item)),
    });
  }

  const others = group ? copy.groups.filter((item) => item.bucket !== group.bucket && hasText(item)) : [];
  const missing = group ? workspace?.missing[group.bucket] ?? [] : [];
  const missingCount = group ? (workspace ? missing.length : group.missingHook ?? 0) : 0;

  return (
    <div className="px-lg py-md lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-lg">
      <Narrative narrative={narrative} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-sm" role="tablist" aria-label="Group">
          {copy.groups.map((entry, i) => {
            const status = groupStatus(entry);
            const noted = Boolean(clientNotes[sourceGroupKey(entry.bucket)]?.trim());
            return (
              <button
                key={entry.bucket}
                type="button"
                role="tab"
                aria-selected={i === index}
                className={tabClass(i === index)}
                onClick={() => setActive(i)}
              >
                {BUCKET_LABEL[entry.bucket]} · {entry.funds} · {STATUS_LABEL[status]}
                {noted ? " · client note" : ""}
              </button>
            );
          })}
        </div>

        {group ? (
          <div className="mt-md">
            <div className="flex flex-wrap items-center gap-md">
              <div className="flex gap-xs" role="tablist" aria-label="View">
                {[false, true].map((value) => (
                  <button
                    key={String(value)}
                    type="button"
                    role="tab"
                    aria-selected={preview === value}
                    className={`rounded-md px-sm py-xs text-body-sm transition-colors duration-hover ${
                      preview === value ? "bg-primary-tint text-heading" : "text-secondary hover:text-heading"
                    }`}
                    onClick={() => setPreview(value)}
                  >
                    {value ? "Preview" : "Write"}
                  </button>
                ))}
              </div>
              {!preview && others.length ? (
                <span className="ml-auto flex flex-wrap gap-sm text-body-sm text-muted">
                  Copy from:
                  {others.map((item) => (
                    <button key={item.bucket} type="button" className={linkClass} onClick={() => copyFrom(item)}>
                      {BUCKET_LABEL[item.bucket]}
                    </button>
                  ))}
                </span>
              ) : null}
            </div>

            {missingCount ? (
              <p className="mt-sm text-body-sm text-warning">
                {missingCount} fund{missingCount === 1 ? " has" : "s have"} no {SOURCE_FIELD_LABEL[HOOK_FIELD[group.bucket]].toLowerCase()}
                {missing.length ? `: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? ", …" : ""}` : ""}
              </p>
            ) : null}

            {clientNotes[key]?.trim() ? (
              <p className="mt-sm whitespace-pre-wrap rounded-md border border-warning/40 px-md py-sm text-body-sm text-secondary">
                <span className="text-heading">Client&apos;s feedback:</span>
                {"\n"}
                {clientNotes[key]}
              </p>
            ) : null}

            {preview ? (
              <GroupPreview
                key={group.bucket}
                group={group}
                optOutLine={copy.opt_out_line}
                samples={workspace?.samples[group.bucket] ?? []}
              />
            ) : (
              <ol className="mt-md space-y-lg">
                {group.emails.map((email, position) => (
                  <EmailEditor
                    key={`${key}-${position}`}
                    email={email}
                    position={position}
                    bucket={group.bucket}
                    onChange={(field, value) => updateEmail(position, field, value)}
                  />
                ))}
              </ol>
            )}
          </div>
        ) : null}

        <label className="mt-xl block border-t border-border pt-lg text-body-sm text-secondary">
          Opt-out line (first email only)
          <input
            className={`${inputClass} mt-sm`}
            maxLength={300}
            value={copy.opt_out_line}
            onChange={(event) => onChange({ ...copy, opt_out_line: event.target.value })}
          />
        </label>
      </div>
    </div>
  );
}
