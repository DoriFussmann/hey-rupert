"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { QuestionThread } from "@/components/setup/question-thread";
import { ReviewActions } from "@/components/setup/review-actions";
import { WithFields } from "@/app/portal/setup/email-copy/typed-copy-review";
import type { SetupQuestion } from "@/lib/setup";
import {
  ALL_EMAILS_LABEL,
  feedbackPointCount,
  feedbackPointsText,
  type FeedbackPoint,
} from "@/lib/outreach/feedback-points";
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

const smallButton =
  "rounded-md border border-border bg-surface px-sm py-xs text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

// A group's points travel as one note (4,000 characters at most).
const POINT_MAX = 400;
const POINTS_PER_GROUP = 8;

type About = FeedbackPoint["about"];
type Feedback = {
  /** Added points, by group key. */
  points: Record<string, FeedbackPoint[]>;
  /** Text typed but not added yet, by group key and email. It is sent too. */
  drafts: Record<string, string>;
};

const EMPTY: Feedback = { points: {}, drafts: {} };
const slotKey = (group: string, about: About) => `${group}|${about}`;
const storageKey = (version: number) => `rupert:email-copy-feedback:v${version}`;

/** A group's points, with what is typed but not added yet. */
function groupPoints(feedback: Feedback, group: string, emails: number): FeedbackPoint[] {
  const abouts: About[] = ["all", ...Array.from({ length: emails }, (_, position) => position)];
  const typed = abouts
    .map((about) => ({ id: `draft-${about}`, about, text: feedback.drafts[slotKey(group, about)] ?? "" }))
    .filter((point) => point.text.trim());
  return [...(feedback.points[group] ?? []), ...typed].slice(0, POINTS_PER_GROUP);
}

/** The points on one email (or on the whole group), and a box to add another. */
function PointList({
  label,
  placeholder,
  points,
  draft,
  full,
  readOnly,
  onDraft,
  onAdd,
  onRemove,
}: {
  label: string;
  placeholder: string;
  points: FeedbackPoint[];
  draft: string;
  /** The group has all the points it can take. */
  full: boolean;
  readOnly: boolean;
  onDraft: (text: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="mt-md">
      <p className="text-label uppercase tracking-label text-muted">{label}</p>
      {points.length > 0 ? (
        <ul className="mt-sm space-y-xs">
          {points.map((point) => (
            <li
              key={point.id}
              className="flex items-start justify-between gap-sm rounded-md border border-border bg-background px-sm py-xs text-body-sm text-body"
            >
              <span className="whitespace-pre-wrap">{point.text}</span>
              <button type="button" className={smallButton} disabled={readOnly} onClick={() => onRemove(point.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {full ? (
        <p className="mt-sm text-body-sm text-muted">
          That&apos;s {POINTS_PER_GROUP} points on this group. Send these; you can add more on the next version.
        </p>
      ) : (
        <div className="mt-sm flex items-start gap-sm">
          <textarea
            aria-label={label}
            className="w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary"
            rows={2}
            maxLength={POINT_MAX}
            value={draft}
            disabled={readOnly}
            onChange={(event) => onDraft(event.target.value)}
            placeholder={placeholder}
          />
          <button type="button" className={smallButton} disabled={readOnly || !draft.trim()} onClick={onAdd}>
            {points.length > 0 ? "Add Another" : "Add Point"}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The client's view of copy by source: one tab per group, two emails each.
 * Feedback is a list of points: as many as they like on each email and on the
 * group as a whole, across all groups. Nothing is sent, and the turn stays
 * theirs, until they request changes (or confirm).
 */
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
  const [feedback, setFeedback] = useState<Feedback>(EMPTY);
  const [restored, setRestored] = useState(false);
  const index = Math.min(active, Math.max(copy.groups.length - 1, 0));
  const group = copy.groups[index];
  const key = group ? sourceGroupKey(group.bucket) : "";

  // Points survive a refresh until they are sent or a new version arrives.
  useEffect(() => {
    if (readOnly) return;
    if (!open) {
      // Sent: the points are in the answer now.
      try {
        window.localStorage.removeItem(storageKey(version));
      } catch {
        // Storage is off.
      }
      return;
    }
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey(version)) ?? "null") as Feedback | null;
      if (saved && typeof saved.points === "object" && typeof saved.drafts === "object") setFeedback(saved);
    } catch {
      // Nothing saved, or storage is off: start empty.
    }
    setRestored(true);
  }, [open, readOnly, version]);

  useEffect(() => {
    if (!restored) return;
    try {
      window.localStorage.setItem(storageKey(version), JSON.stringify(feedback));
    } catch {
      // Storage is off: the points live for this visit only.
    }
  }, [feedback, restored, version]);

  // One note per group: its points, a line each.
  const { notes, counts, total } = useMemo(() => {
    const notes: Record<string, string> = {};
    const counts: Record<string, number> = {};
    let total = 0;
    for (const entry of copy.groups) {
      const groupKey = sourceGroupKey(entry.bucket);
      const points = groupPoints(feedback, groupKey, entry.emails.length);
      counts[groupKey] = feedbackPointCount(points);
      total += counts[groupKey];
      const text = feedbackPointsText(points, SOURCE_SEQUENCE_LABELS);
      if (text) notes[groupKey] = text;
    }
    return { notes, counts, total };
  }, [copy.groups, feedback]);

  const added = feedback.points[key] ?? [];
  const full = added.length >= POINTS_PER_GROUP;

  function setDraft(about: About, text: string) {
    setFeedback((existing) => ({ ...existing, drafts: { ...existing.drafts, [slotKey(key, about)]: text } }));
  }

  function addPoint(about: About) {
    setFeedback((existing) => {
      const slot = slotKey(key, about);
      const text = (existing.drafts[slot] ?? "").trim();
      const current = existing.points[key] ?? [];
      if (!text || current.length >= POINTS_PER_GROUP) return existing;
      const id = `${Date.now()}-${current.length}`;
      return {
        points: { ...existing.points, [key]: [...current, { id, about, text }] },
        drafts: { ...existing.drafts, [slot]: "" },
      };
    });
  }

  function removePoint(id: string) {
    setFeedback((existing) => ({
      ...existing,
      points: { ...existing.points, [key]: (existing.points[key] ?? []).filter((point) => point.id !== id) },
    }));
  }

  const pointList = (about: About, label: string, placeholder: string) => (
    <PointList
      label={label}
      placeholder={placeholder}
      points={added.filter((point) => point.about === about)}
      draft={feedback.drafts[slotKey(key, about)] ?? ""}
      full={full}
      readOnly={readOnly}
      onDraft={(text) => setDraft(about, text)}
      onAdd={() => addPoint(about)}
      onRemove={removePoint}
    />
  );

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
            {counts[sourceGroupKey(entry.bucket)] ? ` · ${counts[sourceGroupKey(entry.bucket)]} to change` : ""}
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
                {open
                  ? pointList(
                      position,
                      `Feedback on the ${SOURCE_SEQUENCE_LABELS[position].toLowerCase()}`,
                      "One thing to change in this email",
                    )
                  : null}
              </li>
            ))}
          </ol>

          {sentNotes[key] ? (
            <p className="mx-lg mb-md whitespace-pre-wrap rounded-md bg-background px-sm py-xs text-body-sm text-secondary">
              <span className="text-heading">Your feedback:</span>
              {"\n"}
              {sentNotes[key]}
            </p>
          ) : null}

          {open ? (
            <div className="border-t border-border px-lg pb-lg">
              {pointList(
                "all",
                `Feedback on ${ALL_EMAILS_LABEL.toLowerCase()}`,
                "Something that goes for both emails in this group",
              )}
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
          itemNoteCount={total}
          itemNoun="feedback point"
          itemNotesLabel="on the emails"
          confirmLabel="Confirm Emails"
          changesLabel="Send Feedback"
          intro="Add as many feedback points as you like, on any email in any group; nothing is sent until you choose Send Feedback. Or confirm the emails, or ask Rupert a question."
          readOnly={readOnly}
        />
      ) : null}
    </>
  );
}
