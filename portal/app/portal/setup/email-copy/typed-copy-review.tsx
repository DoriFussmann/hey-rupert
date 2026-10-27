"use client";

import type { PreviewLeads } from "@/lib/outreach/preview";
import { EmailPreview } from "@/components/email-preview";
import { Fragment, useState } from "react";
import { QuestionThread } from "@/components/setup/question-thread";
import { ReviewActions } from "@/components/setup/review-actions";
import { NOTE_MAX, type CopyEmail, type SetupQuestion } from "@/lib/setup";
import type { QuickFact } from "@/lib/outreach/core";
import {
  OTHER_TIERS,
  OTHER_TIER_LABEL,
  SEQUENCE_LABELS,
  groupKey,
  groupLabel,
  type CopySection,
  type TypedCopy,
  type TypedGroupCopy,
} from "@/lib/outreach/copy";

const FIELD_LABEL: Record<string, string> = {
  first_name: "their first name",
  fund_name: "fund name",
  quick_fact: "a fact about this investor",
  tier_line: "why this investor",
};

/** Text with each {{field}} shown as a highlighted, readable label. */
export function WithFields({ text, tierLine }: { text: string; tierLine?: string }) {
  const parts = text.split(/(\{\{\s*[^{}]*?\s*\}\})/g);
  return (
    <>
      {parts.map((part, index) => {
        const match = /^\{\{\s*([^{}]*?)\s*\}\}$/.exec(part);
        if (!match) return <Fragment key={index}>{part}</Fragment>;
        const field = match[1];
        if (field === "tier_line" && tierLine) {
          return (
            <mark key={index} className="rounded-sm bg-primary-tint px-xs text-heading">
              <WithFields text={tierLine} />
            </mark>
          );
        }
        return (
          <mark key={index} className="rounded-sm bg-primary-tint px-xs text-primary">
            [{FIELD_LABEL[field] ?? field}]
          </mark>
        );
      })}
    </>
  );
}

/** One approved Core contact, as the client sees it. */
export type ClientCoreEmail = {
  id: string;
  fund_name: string;
  fund_type: string;
  person_name: string;
  person_title: string;
  quick_facts: QuickFact[];
  emails: CopyEmail[];
};

function CoreEmailsList({ items, optOut }: { items: ClientCoreEmail[]; optOut: string }) {
  return (
    <details className="mt-lg rounded-card border border-border bg-surface">
      <summary className="cursor-pointer px-lg py-md text-body-sm text-heading">
        See all {items.length} personal Core emails (optional)
      </summary>
      <ul className="divide-y divide-border border-t border-border">
        {items.map((item) => (
          <li key={item.id} className="px-lg py-md">
            <p className="text-body-sm text-heading">
              {item.person_name || "Investor"}
              {item.person_title ? <span className="text-muted"> · {item.person_title}</span> : null}
              <span className="text-muted"> · {item.fund_name}</span>
            </p>
            {item.quick_facts.length ? (
              <div className="mt-sm">
                <p className="text-label uppercase tracking-label text-muted">Quick Facts on Prospect</p>
                <ul className="mt-xs space-y-xs text-body-sm">
                  {item.quick_facts.map((fact, index) => (
                    <li key={index}>
                      {fact.fact}{" "}
                      <a href={fact.url} target="_blank" rel="noreferrer" className="text-primary underline hover:text-primary-hover">
                        source
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <ol className="mt-sm space-y-sm">
              {item.emails.map((email, index) => (
                <li key={index}>
                  <p className="text-label uppercase tracking-label text-muted">
                    {SEQUENCE_LABELS[index]}
                    {email.subject.trim() ? ` · ${email.subject}` : index > 0 ? " · same thread" : ""}
                  </p>
                  <div className="mt-xs whitespace-pre-wrap rounded-md bg-background px-md py-sm text-body-sm text-body">
                    {email.body}
                    {index === 0 && optOut ? `\n\n${optOut}` : ""}
                  </div>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </details>
  );
}

const tabClass = (active: boolean) =>
  `rounded-md px-md py-sm text-body-sm transition-colors duration-hover ${
    active ? "bg-primary text-white" : "border border-border bg-surface text-secondary hover:text-heading"
  }`;

function sectionFunds(groups: TypedGroupCopy[]) {
  return groups.reduce((sum, group) => sum + group.funds, 0);
}

export function TypedCopyReview({
  typed,
  version,
  open,
  sentNotes,
  adminNote,
  questions = [],
  readOnly,
  coreEmails = [],
  previewLeads = {},
}: {
  typed: TypedCopy;
  version: number;
  open: boolean;
  sentNotes: Record<string, string>;
  adminNote?: React.ReactNode;
  questions?: SetupQuestion[];
  readOnly: boolean;
  /** Core emails Rupert approved, one per contact. */
  coreEmails?: ClientCoreEmail[];
  /** A few real investors per group, for the Preview buttons. */
  previewLeads?: PreviewLeads;
}) {
  const firstSection: CopySection = typed.core.length > 0 ? "core" : "others";
  const [section, setSection] = useState<CopySection>(firstSection);
  const groups = typed[section];
  const [typeIndex, setTypeIndex] = useState(0);
  const group = groups[Math.min(typeIndex, Math.max(groups.length - 1, 0))];
  const [notes, setNotes] = useState<Record<string, string>>({});
  const key = group ? groupKey(section, group.type) : "";
  // Sphere when it has funds: the tier line the first preview shows.
  const previewTier = group?.tier_lines ? OTHER_TIERS.find((tier) => group.tier_lines?.[`${tier}`]) : undefined;
  const previewLine = previewTier ? group?.tier_lines?.[`${previewTier}`] : undefined;

  return (
    <>
      {adminNote}
      <div className="mb-md flex flex-wrap gap-sm" role="tablist" aria-label="Investor group">
        {(["core", "others"] as const)
          .filter((item) => typed[item].length > 0)
          .map((item) => {
            const hasNote = typed[item].some((entry) => notes[groupKey(item, entry.type)]?.trim());
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
                {item === "core" ? "Core investors" : "Sphere, Tier 3 and Tier 4"} · {sectionFunds(typed[item])} funds
                {hasNote ? " •" : ""}
              </button>
            );
          })}
      </div>

      <p className="mb-md max-w-prose text-body-sm text-secondary">
        {section === "core"
          ? "Core investors invest directly in your sector. Each one gets their own version of these emails, written from a few researched facts about their fund and the partner. The highlighted parts change for every investor; Rupert reviews each one before it goes out."
          : "These investors have an adjacent or broader link to your sector. They get the same emails per type of investor, with one line explaining why we're writing to them, which changes by tier."}
      </p>

      {groups.length > 1 ? (
        <div className="mb-md flex flex-wrap gap-sm" role="tablist" aria-label="Type of investor">
          {groups.map((entry, index) => (
            <button
              key={entry.type}
              type="button"
              role="tab"
              aria-selected={group?.type === entry.type}
              className={tabClass(group?.type === entry.type)}
              onClick={() => setTypeIndex(index)}
            >
              {entry.type} · {entry.funds}
              {notes[groupKey(section, entry.type)]?.trim() ? " •" : ""}
            </button>
          ))}
        </div>
      ) : null}

      {group ? (
        <section className="rounded-card border border-border bg-surface">
          <div className="border-b border-border px-lg py-md">
            <h2 className="text-h4">
              {groupLabel(section, group.type)}{" "}
              <span className="text-body text-secondary">
                · {group.funds} funds{group.merged?.length ? ` (includes ${group.merged.join(", ")})` : ""}
              </span>
            </h2>
            {section === "core" && group.approach.trim() ? (
              <p className="mt-sm max-w-prose whitespace-pre-wrap text-body-sm text-body">
                <span className="text-heading">The approach: </span>
                {group.approach}
              </p>
            ) : null}
          </div>

          {section === "others" && OTHER_TIERS.some((tier) => group.tier_lines?.[`${tier}`]) ? (
            <div className="border-b border-border px-lg py-md">
              <p className="text-label uppercase tracking-label text-muted">Why we&apos;re writing, by tier</p>
              <ul className="mt-sm space-y-xs text-body-sm">
                {OTHER_TIERS.filter((tier) => group.tier_lines?.[`${tier}`]).map((tier) => (
                  <li key={tier}>
                    <span className="text-heading">{OTHER_TIER_LABEL[tier]}</span>
                    {group.tiers?.[`${tier}`] ? <span className="text-muted"> ({group.tiers[`${tier}`]} funds)</span> : null}:{" "}
                    <WithFields text={group.tier_lines?.[`${tier}`] ?? ""} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <ol className="divide-y divide-border">
            {group.emails.map((email, index) => (
              <li key={index} className="px-lg py-lg">
                <p className="text-label uppercase tracking-label text-muted">{SEQUENCE_LABELS[index]}</p>
                <p className="mt-sm text-body-sm text-heading">
                  <span className="text-muted">Subject: </span>
                  {email.subject.trim() ? <WithFields text={email.subject} /> : index > 0 ? "(same thread)" : "—"}
                </p>
                <div className="mt-sm whitespace-pre-wrap rounded-md bg-background px-md py-md font-sans text-body-sm text-body">
                  <WithFields text={email.body} tierLine={previewLine} />
                  {index === 0 && typed.opt_out_line ? `\n\n${typed.opt_out_line}` : ""}
                </div>
                <EmailPreview group={group} section={section} index={index} leads={previewLeads[key] ?? []} optOutLine={typed.opt_out_line} />
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

      {section === "core" && coreEmails.length > 0 ? <CoreEmailsList items={coreEmails} optOut={typed.opt_out_line} /> : null}
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
