"use client";

import { EmailBodyField } from "@/components/email-body-field";
import { useState } from "react";
import { inputClass, secondaryButton } from "@/app/admin/clients/[id]/setup/shared";
import {
  BUCKET_DETAIL,
  BUCKET_LABEL,
  HOOK_FIELD,
  SOURCE_FIELDS,
  SOURCE_MAX_WORDS,
  SOURCE_SEQUENCE_LABELS,
  sourceCopyIssues,
  sourceEmailIssues,
  sourceGroupKey,
  type SourceCopy,
} from "@/lib/outreach/source-copy";

const tabClass = (active: boolean) =>
  `rounded-md px-md py-sm text-body-sm transition-colors duration-hover ${
    active ? "bg-primary text-white" : "border border-border bg-surface text-secondary hover:text-heading"
  }`;

const PLAN_TIER_NAME: Record<string, string> = { core: "Core", sphere: "Sphere", tier3: "Tier 3", tier4: "Tier 4" };

const mix = (counts: Record<string, number>, names: Record<string, string> = {}) =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => `${names[key] ?? key} ${n}`)
    .join(", ");

const sentence = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/** Rupert's editor for copy by source: one tab per group, two emails each. */
export function SourceCopyEditor({
  copy,
  onChange,
  onRedraft,
  busy,
  canDraft,
  clientNotes,
}: {
  copy: SourceCopy;
  onChange: (next: SourceCopy) => void;
  /** Redraft one group with AI; the rest stays as it is. */
  onRedraft: (key: string) => void;
  busy: boolean;
  canDraft: boolean;
  /** The client's notes on the last version, by group key. */
  clientNotes: Record<string, string>;
}) {
  const [active, setActive] = useState(0);
  const index = Math.min(active, Math.max(copy.groups.length - 1, 0));
  const group = copy.groups[index];
  const allIssues = sourceCopyIssues(copy);

  function updateEmail(position: number, field: "subject" | "body", value: string) {
    if (!group) return;
    onChange({
      ...copy,
      groups: copy.groups.map((item, i) =>
        i === index ? { ...item, emails: item.emails.map((email, p) => (p === position ? { ...email, [field]: value } : email)) } : item,
      ),
    });
  }

  const key = group ? sourceGroupKey(group.bucket) : "";
  // Problems about the group as a whole (not one email).
  const groupIssues = group
    ? allIssues.filter(
        (issue) => issue.where === BUCKET_LABEL[group.bucket] && !SOURCE_SEQUENCE_LABELS.some((label) => issue.where.endsWith(label)),
      )
    : [];

  return (
    <div className="px-lg py-md">
      <div className="flex flex-wrap gap-sm" role="tablist" aria-label="Group">
        {copy.groups.map((entry, i) => {
          const errors = allIssues.some((issue) => issue.level === "error" && issue.where.startsWith(BUCKET_LABEL[entry.bucket]));
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
              {BUCKET_LABEL[entry.bucket]} · {entry.funds} funds · {entry.contacts} contacts
              {errors ? " ⚠" : ""}
              {noted ? " • client note" : ""}
            </button>
          );
        })}
      </div>

      {group ? (
        <div className="mt-md">
          <p className="text-body-sm text-secondary">{BUCKET_DETAIL[group.bucket]}</p>
          <div className="mt-sm flex flex-wrap items-center gap-sm text-body-sm text-muted">
            <span>
              Types: {mix(group.types) || "—"} · Tiers: {mix(group.tiers, PLAN_TIER_NAME) || "—"}
            </span>
            <span>
              · Fields:{" "}
              {SOURCE_FIELDS[group.bucket].map((field) => (
                <code key={field} className="mr-xs font-mono">{`{{${field}}}`}</code>
              ))}
            </span>
            <button
              type="button"
              className={`${secondaryButton} ml-auto`}
              disabled={busy || !canDraft}
              onClick={() => onRedraft(key)}
            >
              {busy ? "Working…" : "Redraft this group"}
            </button>
          </div>
          {group.examples?.length ? (
            <p className="mt-sm text-body-sm text-muted">
              {`{{${HOOK_FIELD[group.bucket]}}}`} becomes, per fund: {group.examples.join(", ")}
              {group.funds > group.examples.length ? ", …" : ""}
            </p>
          ) : null}

          {clientNotes[key]?.trim() ? (
            <p className="mt-sm rounded-md border border-warning/40 px-md py-sm text-body-sm text-secondary">
              <span className="text-heading">Client&apos;s note:</span> {clientNotes[key]}
            </p>
          ) : null}

          <ol className="mt-md space-y-lg">
            {group.emails.map((email, position) => {
              const issues = sourceEmailIssues(email, position, group.bucket);
              return (
                <li key={`${key}-${position}`}>
                  <p className="text-label uppercase tracking-label text-muted">
                    {SOURCE_SEQUENCE_LABELS[position]} · up to {position === 0 ? SOURCE_MAX_WORDS : Math.round(SOURCE_MAX_WORDS * 0.75)} words
                  </p>
                  <input
                    className={`${inputClass} mt-sm`}
                    value={email.subject}
                    maxLength={300}
                    onChange={(event) => updateEmail(position, "subject", event.target.value)}
                    placeholder={position === 0 ? "Subject" : "Subject (blank = same thread)"}
                    aria-label={`${BUCKET_LABEL[group.bucket]} ${SOURCE_SEQUENCE_LABELS[position]} subject`}
                  />
                  <EmailBodyField
                    className={inputClass}
                    value={email.body}
                    onChange={(value) => updateEmail(position, "body", value)}
                    placeholder="Body"
                    label={`${BUCKET_LABEL[group.bucket]} ${SOURCE_SEQUENCE_LABELS[position]} body`}
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
            })}
          </ol>

          {groupIssues.length ? (
            <ul className="mt-md text-body-sm">
              {groupIssues.map((issue, i) => (
                <li key={i} className={issue.level === "error" ? "text-error" : "text-muted"}>
                  {sentence(issue.text)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <label className="mt-xl block border-t border-border pt-lg text-body-sm text-secondary">
        Opt-out line, under the first email (the follow-up is in the same thread)
        <input
          className={`${inputClass} mt-sm`}
          maxLength={300}
          value={copy.opt_out_line}
          onChange={(event) => onChange({ ...copy, opt_out_line: event.target.value })}
          placeholder="Blank: no opt-out line"
        />
      </label>
    </div>
  );
}
