"use client";

import { useMemo, useState } from "react";
import { draftClientEmailCopy } from "@/app/admin/agent-actions";
import {
  EMAIL_SEQUENCE_LABELS,
  FIT_TIERS,
  LINKEDIN_NOTE_MAX,
  asEmailCopy,
  emailCopyProblems,
  type EmailCopyPayload,
  type FitTier,
  type SetupItem,
  type SetupStepState,
} from "@/lib/setup";
import {
  ClientAnswer,
  EarlierRounds,
  PublishBar,
  StepFrame,
  inputClass,
  secondaryButton,
} from "@/app/admin/clients/[id]/setup/shared";

function hasContent(copy: EmailCopyPayload) {
  return (
    Boolean(copy.linkedin_note?.trim() || copy.linkedin_followup?.trim()) ||
    FIT_TIERS.some(({ tier }) =>
      copy.tiers[`${tier}`].some((email) => email.subject.trim() || email.body.trim()),
    )
  );
}

export function EmailCopyPanel({
  clientId,
  item,
  row,
  tierCounts,
  claudeReady,
}: {
  clientId: string;
  item: SetupItem;
  row: SetupStepState | null;
  tierCounts: { tier: FitTier; count: number }[];
  claudeReady: boolean;
}) {
  const initial = useMemo(() => {
    const draft = asEmailCopy(row?.draft);
    return hasContent(draft) ? draft : asEmailCopy(row?.published);
  }, [row]);

  const [copy, setCopy] = useState<EmailCopyPayload>(initial);
  const [savedKey, setSavedKey] = useState(JSON.stringify(initial));
  const [tier, setTier] = useState<FitTier>(1);
  const [drafting, setDrafting] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const problems = emailCopyProblems(copy);
  const changesRequested = row?.status === "changes_requested";

  function update(index: number, field: "subject" | "body", value: string) {
    setCopy((current) => {
      const key = `${tier}` as const;
      const emails = current.tiers[key].map((email, position) =>
        position === index ? { ...email, [field]: value } : email,
      );
      return { ...current, tiers: { ...current.tiers, [key]: emails } };
    });
  }

  async function onDraft() {
    if (
      hasContent(copy) &&
      !window.confirm(
        changesRequested
          ? "Rebuild the emails with the client's requested changes? It replaces the current draft."
          : "Draft the emails with AI? It replaces the current draft.",
      )
    ) {
      return;
    }
    setDrafting(true);
    setMessage(null);
    try {
      const result = await draftClientEmailCopy(clientId);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setCopy(result.copy);
      setSavedKey(JSON.stringify(result.copy));
      setMessage({ kind: "ok", text: "Draft ready and saved. Edit it, then push." });
    } catch (err) {
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Unable to draft the emails.",
      });
    } finally {
      setDrafting(false);
    }
  }

  function copyFromTier(source: FitTier) {
    if (
      !window.confirm(
        `Replace the Tier ${tier} emails with a copy of Tier ${source}?`,
      )
    ) {
      return;
    }
    setCopy((current) => ({
      ...current,
      tiers: {
        ...current.tiers,
        [`${tier}`]: current.tiers[`${source}`].map((email) => ({ ...email })),
      },
    }));
  }

  const tabClass = (active: boolean) =>
    `rounded-md px-md py-sm text-body-sm transition-colors duration-hover ${
      active
        ? "bg-primary text-white"
        : "border border-border bg-surface text-secondary hover:text-heading"
    }`;

  return (
    <StepFrame
      item={item}
      intro="A first email and two follow-ups for each fit tier. Leave a follow-up subject blank to send it in the same thread. Use placeholders like {{first_name}} and {{fund_name}} for personal details."
    >
      <ClientAnswer row={row} />
      {changesRequested ? (
        <p className="px-lg pt-md text-body-sm text-secondary">
          The emails do not need to change. Write a reply when you push if you want. The
          client sees that reply above Confirm.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-sm border-b border-border px-lg py-md">
        <button
          type="button"
          className={secondaryButton}
          disabled={drafting || !claudeReady}
          onClick={onDraft}
        >
          {drafting
            ? "Drafting…"
            : changesRequested
              ? "Rebuild with client's changes"
              : "Draft with AI"}
        </button>
        <p className="text-body-sm text-muted" aria-live="polite">
          {drafting
            ? "Writing the nine emails and the LinkedIn messages. Usually under a minute."
            : !claudeReady
              ? "Claude is not configured (ANTHROPIC_API_KEY)."
              : "Uses the AI Agents → Email copy instructions."}
        </p>
        {message ? (
          <p
            className={`w-full text-body-sm ${message.kind === "error" ? "text-error" : "text-success"}`}
            role={message.kind === "error" ? "alert" : "status"}
          >
            {message.text}
          </p>
        ) : null}
      </div>
      <div className="px-lg py-md">
        <div className="flex flex-wrap items-center gap-sm" role="tablist" aria-label="Tier">
          {FIT_TIERS.map((entry) => {
            const count = tierCounts.find((item) => item.tier === entry.tier)?.count ?? 0;
            return (
              <button
                key={entry.tier}
                type="button"
                role="tab"
                aria-selected={tier === entry.tier}
                className={tabClass(tier === entry.tier)}
                onClick={() => setTier(entry.tier)}
              >
                {entry.label} · {entry.detail}
                {count ? ` · ${count}` : ""}
              </button>
            );
          })}
          <span className="ml-auto flex flex-wrap gap-xs text-body-sm text-muted">
            Copy from:
            {FIT_TIERS.filter((entry) => entry.tier !== tier).map((entry) => (
              <button
                key={entry.tier}
                type="button"
                className="text-primary hover:text-primary-hover"
                onClick={() => copyFromTier(entry.tier)}
              >
                {entry.label}
              </button>
            ))}
          </span>
        </div>

        <ol className="mt-md space-y-lg">
          {copy.tiers[`${tier}`].map((email, index) => (
            <li key={`${tier}-${index}`}>
              <p className="text-label uppercase tracking-label text-muted">
                {EMAIL_SEQUENCE_LABELS[index]}
              </p>
              <input
                className={`${inputClass} mt-sm`}
                value={email.subject}
                maxLength={300}
                onChange={(event) => update(index, "subject", event.target.value)}
                placeholder={index === 0 ? "Subject" : "Subject (blank = same thread)"}
                aria-label={`Tier ${tier} ${EMAIL_SEQUENCE_LABELS[index]} subject`}
              />
              <textarea
                className={`${inputClass} mt-sm`}
                rows={index === 0 ? 10 : 6}
                maxLength={10000}
                value={email.body}
                onChange={(event) => update(index, "body", event.target.value)}
                placeholder="Body"
                aria-label={`Tier ${tier} ${EMAIL_SEQUENCE_LABELS[index]} body`}
              />
            </li>
          ))}
        </ol>

        <div className="mt-xl border-t border-border pt-lg">
          <p className="text-label uppercase tracking-label text-muted">
            LinkedIn · one set for every tier
          </p>
          <label className="mt-md block text-body-sm text-secondary">
            Connection note
            <span className="ml-sm text-muted">
              {(copy.linkedin_note ?? "").length}/{LINKEDIN_NOTE_MAX}
            </span>
            <textarea
              className={`${inputClass} mt-sm`}
              rows={3}
              maxLength={2000}
              value={copy.linkedin_note ?? ""}
              onChange={(event) =>
                setCopy((current) => ({ ...current, linkedin_note: event.target.value }))
              }
              placeholder="Short note sent with the connection request"
              aria-label="LinkedIn connection note"
            />
          </label>
          <label className="mt-md block text-body-sm text-secondary">
            Follow-up
            <textarea
              className={`${inputClass} mt-sm`}
              rows={5}
              maxLength={10000}
              value={copy.linkedin_followup ?? ""}
              onChange={(event) =>
                setCopy((current) => ({ ...current, linkedin_followup: event.target.value }))
              }
              placeholder="Message after they connect"
              aria-label="LinkedIn follow-up"
            />
          </label>
        </div>

        {problems.length > 0 ? (
          <p className="mt-md text-body-sm text-muted">
            Before pushing: {problems.join(" ")}
          </p>
        ) : null}
      </div>
      <EarlierRounds row={row} />
      <PublishBar
        clientId={clientId}
        step="email_copy"
        item={item}
        row={row}
        draft={copy}
        dirty={JSON.stringify(copy) !== savedKey}
        onSaved={() => setSavedKey(JSON.stringify(copy))}
        pushLabel="Push emails for confirmation"
        problem={problems.length > 0 ? problems.join(" ") : null}
        noteLabel="Reply (optional). Shown on their page, above Confirm, and in the email."
        notePlaceholder="For example: softened the first email."
        noteOnPage
      />
    </StepFrame>
  );
}
