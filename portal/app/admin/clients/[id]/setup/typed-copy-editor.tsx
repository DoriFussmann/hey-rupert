"use client";

import type { PreviewLeads } from "@/lib/outreach/preview";
import { EmailPreview } from "@/components/email-preview";
import { AutoTextarea, EmailBodyField } from "@/components/email-body-field";
import { useState } from "react";
import { inputClass, secondaryButton } from "@/app/admin/clients/[id]/setup/shared";
import {
  MERGE_FIELDS,
  OTHER_TIERS,
  OTHER_TIER_LABEL,
  SEQUENCE_LABELS,
  emailIssues,
  groupKey,
  groupLabel,
  typedCopyIssues,
  type CopySection,
  type TypedCopy,
  type TypedGroupCopy,
} from "@/lib/outreach/copy";

const tabClass = (active: boolean) =>
  `rounded-md px-md py-sm text-body-sm transition-colors duration-hover ${
    active ? "bg-primary text-white" : "border border-border bg-surface text-secondary hover:text-heading"
  }`;

export function TypedCopyEditor({
  typed,
  onChange,
  onRedraft,
  busy,
  canDraft,
  clientNotes,
  previewLeads = {},
}: {
  typed: TypedCopy;
  onChange: (next: TypedCopy) => void;
  /** Redraft one group with AI; the rest stays as it is. */
  onRedraft: (key: string) => void;
  busy: boolean;
  canDraft: boolean;
  /** The client's notes on the last version, by group key. */
  clientNotes: Record<string, string>;
  /** A few real leads per group, for the Preview buttons. */
  previewLeads?: PreviewLeads;
}) {
  const [section, setSection] = useState<CopySection>(typed.core.length > 0 ? "core" : "others");
  const [typeIndex, setTypeIndex] = useState(0);
  const groups = typed[section];
  const index = Math.min(typeIndex, Math.max(groups.length - 1, 0));
  const group = groups[index];
  const allIssues = typedCopyIssues(typed);

  function updateGroup(patch: Partial<TypedGroupCopy>) {
    onChange({
      ...typed,
      [section]: typed[section].map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });
  }

  function updateEmail(position: number, field: "subject" | "body", value: string) {
    if (!group) return;
    updateGroup({
      emails: group.emails.map((email, i) => (i === position ? { ...email, [field]: value } : email)),
    });
  }

  const issuesFor = (sec: CopySection, item: TypedGroupCopy) =>
    allIssues.filter((issue) => issue.where.startsWith(groupLabel(sec, item.type)));
  const key = group ? groupKey(section, group.type) : "";
  const groupIssues = group ? issuesFor(section, group) : [];

  return (
    <div className="px-lg py-md">
      <div className="flex flex-wrap gap-sm" role="tablist" aria-label="Section">
        {(["core", "others"] as const)
          .filter((item) => typed[item].length > 0)
          .map((item) => {
            const errors = typed[item].some((entry) => issuesFor(item, entry).some((issue) => issue.level === "error"));
            return (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={section === item}
                className={tabClass(section === item)}
                onClick={() => {
                  setSection(item);
                  setTypeIndex(0);
                }}
              >
                {item === "core" ? "Core" : "Sphere, Tier 3, Tier 4"} ·{" "}
                {typed[item].reduce((sum, entry) => sum + entry.funds, 0)} funds{errors ? " · needs work" : ""}
              </button>
            );
          })}
      </div>

      <div className="mt-sm flex flex-wrap gap-sm" role="tablist" aria-label="Fund type">
        {groups.map((entry, i) => {
          const errors = issuesFor(section, entry).some((issue) => issue.level === "error");
          const noted = Boolean(clientNotes[groupKey(section, entry.type)]?.trim());
          return (
            <button
              key={entry.type}
              type="button"
              role="tab"
              aria-selected={i === index}
              className={tabClass(i === index)}
              onClick={() => setTypeIndex(i)}
            >
              {entry.type} · {entry.funds}
              {errors ? " ⚠" : ""}
              {noted ? " • client note" : ""}
            </button>
          );
        })}
      </div>

      {group ? (
        <div className="mt-md">
          <div className="flex flex-wrap items-center gap-sm text-body-sm text-muted">
            <span>
              Style: <span className="text-heading">{group.style.label}</span> · first email up to {group.style.max_words} words
              {group.merged?.length ? ` · includes ${group.merged.join(", ")}` : ""}
            </span>
            <span>
              · Fields:{" "}
              {MERGE_FIELDS[section].map((field) => (
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

          {clientNotes[key]?.trim() ? (
            <p className="mt-sm rounded-md border border-warning/40 px-md py-sm text-body-sm text-secondary">
              <span className="text-heading">Client&apos;s note:</span> {clientNotes[key]}
            </p>
          ) : null}

          {section === "core" ? (
            <p className="mt-md rounded-md bg-background px-md py-sm text-body-sm text-secondary">
              <span className="text-heading">This is a template, never sent as is.</span>{" "}
              {"{{quick_fact}}"} marks where each investor&apos;s email gets its personal line. Under Core contacts (below),
              Write researches each partner and fund, then rewrites this template for that one person: the{" "}
              {"{{quick_fact}}"} sentence becomes something true about them, with its source shown as a Quick Fact, and
              their name and fund are filled in.
            </p>
          ) : null}

          {section === "core" ? (
            <label className="mt-md block text-body-sm text-secondary">
              Approach (shown to the client)
              <AutoTextarea
                className={`${inputClass} mt-sm`}
                maxLength={4000}
                value={group.approach}
                onChange={(event) => updateGroup({ approach: event.target.value })}
                placeholder="What this kind of investor cares about, and how the emails lead"
              />
            </label>
          ) : (
            <div className="mt-md grid gap-sm">
              {OTHER_TIERS.filter((tier) => group.tiers?.[`${tier}`]).map((tier) => (
                <label key={tier} className="block text-body-sm text-secondary">
                  {OTHER_TIER_LABEL[tier]} line · {group.tiers?.[`${tier}`]} funds (replaces {"{{tier_line}}"})
                  <input
                    className={`${inputClass} mt-sm`}
                    maxLength={600}
                    value={group.tier_lines?.[`${tier}`] ?? ""}
                    onChange={(event) =>
                      updateGroup({ tier_lines: { ...group.tier_lines, [`${tier}`]: event.target.value } })
                    }
                  />
                </label>
              ))}
            </div>
          )}

          <ol className="mt-md space-y-lg">
            {group.emails.map((email, position) => {
              const issues = emailIssues(email, position, section, group.style.max_words, "");
              return (
                <li key={`${key}-${position}`}>
                  <p className="text-label uppercase tracking-label text-muted">{SEQUENCE_LABELS[position]}</p>
                  <input
                    className={`${inputClass} mt-sm`}
                    value={email.subject}
                    maxLength={300}
                    onChange={(event) => updateEmail(position, "subject", event.target.value)}
                    placeholder={position === 0 ? "Subject" : "Subject (blank = same thread)"}
                    aria-label={`${groupLabel(section, group.type)} ${SEQUENCE_LABELS[position]} subject`}
                  />
                  <EmailBodyField
                    className={inputClass}
                    value={email.body}
                    onChange={(value) => updateEmail(position, "body", value)}
                    placeholder="Body"
                    label={`${groupLabel(section, group.type)} ${SEQUENCE_LABELS[position]} body`}
                  />
                  <EmailPreview
                    group={group}
                    section={section}
                    index={position}
                    leads={previewLeads[key] ?? []}
                    optOutLine={typed.opt_out_line}
                  />
                  {issues.length ? (
                    <ul className="mt-xs text-body-sm">
                      {issues.map((issue, i) => (
                        <li key={i} className={issue.level === "error" ? "text-error" : "text-muted"}>
                          {issue.text.charAt(0).toUpperCase() + issue.text.slice(1)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>

          {groupIssues.some((issue) => !SEQUENCE_LABELS.some((label) => issue.where.endsWith(label))) ? (
            <ul className="mt-md text-body-sm">
              {groupIssues
                .filter((issue) => !SEQUENCE_LABELS.some((label) => issue.where.endsWith(label)))
                .map((issue, i) => (
                  <li key={i} className={issue.level === "error" ? "text-error" : "text-muted"}>
                    {issue.text.charAt(0).toUpperCase() + issue.text.slice(1)}
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <label className="mt-xl block border-t border-border pt-lg text-body-sm text-secondary">
        Opt-out line, under the first email (follow-ups are in the same thread)
        <input
          className={`${inputClass} mt-sm`}
          maxLength={300}
          value={typed.opt_out_line}
          onChange={(event) => onChange({ ...typed, opt_out_line: event.target.value })}
          placeholder="Blank: no opt-out line"
        />
      </label>
    </div>
  );
}
