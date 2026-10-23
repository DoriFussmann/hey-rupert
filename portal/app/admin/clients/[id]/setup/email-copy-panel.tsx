"use client";

import { useMemo, useState } from "react";
import { draftClientEmailCopy } from "@/app/admin/agent-actions";
import { DocumentStep, sendStatus } from "@/app/admin/clients/[id]/setup/document-step";
import { EmailCopyReview } from "@/app/portal/setup/email-copy/email-copy-review";
import {
  EMAIL_SEQUENCE_LABELS,
  LINKEDIN_NOTE_MAX,
  asClientEmail,
  asEmailCopy,
  emailCopyProblems,
  emptyEmailCopy,
  fitTiersFor,
  tierEmails,
  type EmailCopyPayload,
  type FitTier,
  type SetupItem,
  type SetupStepState,
  type TierScheme,
} from "@/lib/setup";
import {
  ClientAnswer,
  ClientQuestions,
  EarlierRounds,
  StepFrame,
  inputClass,
  secondaryButton,
} from "@/app/admin/clients/[id]/setup/shared";

function hasContent(copy: EmailCopyPayload) {
  return (
    Boolean(copy.linkedin_note?.trim() || copy.linkedin_followup?.trim()) ||
    fitTiersFor(copy.tier_scheme).some(({ tier }) =>
      tierEmails(copy, tier).some((email) => email.subject.trim() || email.body.trim()),
    )
  );
}

/** The copy as Rupert edits it: no reply and no questions (those live on the published version). */
function editable(value: unknown): EmailCopyPayload {
  return { ...asEmailCopy(value), admin_note: undefined, questions: undefined };
}

export function EmailCopyPanel({
  clientId,
  item,
  row,
  to,
  tierCounts,
  listScheme,
  claudeReady,
}: {
  clientId: string;
  item: SetupItem;
  row: SetupStepState | null;
  /** The client's email address. */
  to: string;
  /** Funds per tier of the confirmed investor list, in its own scheme. */
  tierCounts: { tier: FitTier; count: number }[];
  /** How the confirmed investor list groups its funds. New copy follows it. */
  listScheme: TierScheme;
  claudeReady: boolean;
}) {
  const initial = useMemo(() => {
    const draft = editable(row?.draft);
    if (hasContent(draft)) return draft;
    const published = editable(row?.published);
    return hasContent(published) ? published : emptyEmailCopy(listScheme);
  }, [row, listScheme]);
  const initialEmail = asClientEmail(
    row?.draft && typeof row.draft === "object"
      ? (row.draft as Record<string, unknown>).client_email
      : null,
  );

  const [copy, setCopy] = useState<EmailCopyPayload>(initial);
  const [savedKey, setSavedKey] = useState(JSON.stringify(initial));
  const [tier, setTier] = useState<FitTier>(1);
  const [drafting, setDrafting] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const problems = emailCopyProblems(copy);
  const changesRequested = row?.status === "changes_requested";
  const copyScheme: TierScheme = copy.tier_scheme ?? "three";
  const tiers = fitTiersFor(copyScheme);
  const schemeMismatch = copyScheme !== listScheme;
  const activeTier: FitTier = tiers.some((entry) => entry.tier === tier) ? tier : 1;

  function tierName(value: FitTier) {
    return tiers.find((entry) => entry.tier === value)?.label ?? `Tier ${value}`;
  }

  function startListScheme() {
    const count = listScheme === "four" ? "four" : "three";
    if (
      !window.confirm(
        `Start a new ${count}-tier copy to match the investor list? It replaces this draft (the copy already sent to the client is not changed).`,
      )
    ) {
      return;
    }
    setCopy({
      ...emptyEmailCopy(listScheme),
      linkedin_note: copy.linkedin_note,
      linkedin_followup: copy.linkedin_followup,
    });
    setTier(1);
  }

  function update(index: number, field: "subject" | "body", value: string) {
    setCopy((current) => {
      const key = `${activeTier}` as const;
      const emails = tierEmails(current, activeTier).map((email, position) =>
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
        `Replace the ${tierName(activeTier)} emails with a copy of ${tierName(source)}?`,
      )
    ) {
      return;
    }
    setCopy((current) => ({
      ...current,
      tiers: {
        ...current.tiers,
        [`${activeTier}`]: tierEmails(current, source).map((email) => ({ ...email })),
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
      <p className="px-lg pt-md text-body-sm text-muted">{sendStatus(row)}</p>
      <ClientAnswer row={row} hideWaiting />
      <ClientQuestions clientId={clientId} step="email_copy" row={row} />
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
            ? `Writing the ${tiers.length * 3} emails and the LinkedIn messages. Usually under a minute.`
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
      {schemeMismatch ? (
        <div role="alert" className="mx-lg mt-md rounded-md border border-warning/40 px-md py-sm text-body-sm text-warning">
          This copy has {copyScheme === "four" ? "four" : "three"} tiers; the confirmed investor list has{" "}
          {listScheme === "four" ? "four" : "three"}.{" "}
          <button type="button" className="text-primary underline hover:text-primary-hover" onClick={startListScheme}>
            Start a {listScheme === "four" ? "four" : "three"}-tier copy
          </button>
        </div>
      ) : null}
      <div className="px-lg py-md">
        <div className="flex flex-wrap items-center gap-sm" role="tablist" aria-label="Tier">
          {tiers.map((entry) => {
            const count = schemeMismatch ? 0 : tierCounts.find((item) => item.tier === entry.tier)?.count ?? 0;
            return (
              <button
                key={entry.tier}
                type="button"
                role="tab"
                aria-selected={activeTier === entry.tier}
                className={tabClass(activeTier === entry.tier)}
                onClick={() => setTier(entry.tier)}
              >
                {entry.label} · {entry.detail}
                {count ? ` · ${count}` : ""}
              </button>
            );
          })}
          <span className="ml-auto flex flex-wrap gap-xs text-body-sm text-muted">
            Copy from:
            {tiers.filter((entry) => entry.tier !== activeTier).map((entry) => (
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
          {tierEmails(copy, activeTier).map((email, index) => (
            <li key={`${activeTier}-${index}`}>
              <p className="text-label uppercase tracking-label text-muted">
                {EMAIL_SEQUENCE_LABELS[index]}
              </p>
              <input
                className={`${inputClass} mt-sm`}
                value={email.subject}
                maxLength={300}
                onChange={(event) => update(index, "subject", event.target.value)}
                placeholder={index === 0 ? "Subject" : "Subject (blank = same thread)"}
                aria-label={`${tierName(activeTier)} ${EMAIL_SEQUENCE_LABELS[index]} subject`}
              />
              <textarea
                className={`${inputClass} mt-sm`}
                rows={index === 0 ? 10 : 6}
                maxLength={10000}
                value={email.body}
                onChange={(event) => update(index, "body", event.target.value)}
                placeholder="Body"
                aria-label={`${tierName(activeTier)} ${EMAIL_SEQUENCE_LABELS[index]} body`}
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
      <DocumentStep
        clientId={clientId}
        step="email_copy"
        item={item}
        row={row}
        to={to}
        draft={copy}
        initialEmail={initialEmail}
        dirty={JSON.stringify(copy) !== savedKey}
        onSaved={() => setSavedKey(JSON.stringify(copy))}
        problem={problems.length > 0 ? problems.join(" ") : null}
        busy={drafting}
        pushSummary="Pushes the emails and LinkedIn messages above to the client's portal as a new version, and sends them this email. They confirm there, ask a question, or ask for changes."
        clientPreview={
          <EmailCopyReview
            copy={copy}
            counts={schemeMismatch ? [] : tierCounts}
            version={(row?.version ?? 0) + 1}
            open={false}
            sentNotes={{}}
            readOnly
          />
        }
      />
    </StepFrame>
  );
}
