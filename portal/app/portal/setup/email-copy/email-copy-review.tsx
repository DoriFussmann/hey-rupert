"use client";

import { useState } from "react";
import { AdminReply } from "@/components/setup/admin-reply";
import { ReviewActions } from "@/components/setup/review-actions";
import {
  EMAIL_SEQUENCE_LABELS,
  FIT_TIERS,
  NOTE_MAX,
  type EmailCopyPayload,
  type FitTier,
} from "@/lib/setup";

export function EmailCopyReview({
  copy,
  counts,
  version,
  open,
  sentNotes,
  adminNote,
  readOnly,
}: {
  copy: EmailCopyPayload;
  counts: { tier: FitTier; count: number }[];
  version: number;
  open: boolean;
  sentNotes: Record<string, string>;
  adminNote?: string;
  readOnly: boolean;
}) {
  const [tier, setTier] = useState<FitTier>(1);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const key = `tier_${tier}`;
  const emails = copy.tiers[`${tier}`];
  const current = FIT_TIERS.find((entry) => entry.tier === tier)!;

  const tabClass = (active: boolean) =>
    `rounded-md px-md py-sm text-body-sm transition-colors duration-hover ${
      active
        ? "bg-primary text-white"
        : "border border-border bg-surface text-secondary hover:text-heading"
    }`;

  return (
    <>
      {open && adminNote ? (
        <div className="sticky top-0 z-20">
          <AdminReply note={adminNote} />
        </div>
      ) : null}
      <div className="mb-md flex flex-wrap gap-sm" role="tablist" aria-label="Investor tier">
        {FIT_TIERS.map((entry) => {
          const count = counts.find((item) => item.tier === entry.tier)?.count ?? 0;
          const hasNote = Boolean(notes[`tier_${entry.tier}`]?.trim());
          return (
            <button
              key={entry.tier}
              type="button"
              role="tab"
              aria-selected={tier === entry.tier}
              className={tabClass(tier === entry.tier)}
              onClick={() => setTier(entry.tier)}
            >
              {entry.label}
              {count ? ` · ${count} funds` : ""}
              {hasNote ? " •" : ""}
            </button>
          );
        })}
      </div>

      <section className="rounded-card border border-border bg-surface">
        <div className="border-b border-border px-lg py-md">
          <h2 className="text-h4">
            {current.label} <span className="text-body text-secondary">· {current.detail}</span>
          </h2>
        </div>
        <ol className="divide-y divide-border">
          {emails.map((email, index) => (
            <li key={index} className="px-lg py-lg">
              <p className="text-label uppercase tracking-label text-muted">
                {EMAIL_SEQUENCE_LABELS[index]}
              </p>
              <p className="mt-sm text-body-sm text-heading">
                <span className="text-muted">Subject: </span>
                {email.subject.trim() || (index > 0 ? "(same thread)" : "—")}
              </p>
              <div className="mt-sm whitespace-pre-wrap rounded-md bg-background px-md py-md font-sans text-body-sm text-body">
                {email.body}
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
              Note on {current.label} emails (optional)
              <textarea
                className="mt-sm w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm normal-case tracking-normal text-body outline-none focus:border-primary"
                rows={3}
                maxLength={NOTE_MAX}
                value={notes[key] ?? ""}
                disabled={readOnly}
                onChange={(event) =>
                  setNotes((existing) => ({ ...existing, [key]: event.target.value }))
                }
                placeholder="Wording to change, claims to soften, anything for this tier"
              />
            </label>
          </div>
        ) : null}
      </section>

      {copy.linkedin_note?.trim() || copy.linkedin_followup?.trim() ? (
        <section className="mt-lg rounded-card border border-border bg-surface">
          <div className="border-b border-border px-lg py-md">
            <h2 className="text-h4">LinkedIn</h2>
            <p className="mt-xs text-body-sm text-muted">
              One connection note and one follow-up, used for every tier.
            </p>
          </div>
          <div className="divide-y divide-border">
            <div className="px-lg py-lg">
              <p className="text-label uppercase tracking-label text-muted">Connection note</p>
              <p className="mt-sm whitespace-pre-wrap text-body-sm text-body">
                {copy.linkedin_note?.trim() || "—"}
              </p>
            </div>
            <div className="px-lg py-lg">
              <p className="text-label uppercase tracking-label text-muted">Follow-up</p>
              <p className="mt-sm whitespace-pre-wrap text-body-sm text-body">
                {copy.linkedin_followup?.trim() || "—"}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {open ? (
        <>
          <AdminReply note={adminNote} />
          <ReviewActions
            step="email_copy"
            version={version}
            itemNotes={notes}
            confirmLabel="Confirm emails"
            readOnly={readOnly}
          />
        </>
      ) : null}
    </>
  );
}
