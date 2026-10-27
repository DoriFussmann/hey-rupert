"use client";

import type { PreviewLeads } from "@/lib/outreach/preview";
import { loadPreviewLeadsAction } from "@/app/admin/outreach-actions";
import { EmailBodyField } from "@/components/email-body-field";
import { useEffect, useMemo, useState } from "react";
import { draftClientEmailCopy, draftClientTypedCopy } from "@/app/admin/agent-actions";
import { TypedCopyEditor } from "@/app/admin/clients/[id]/setup/typed-copy-editor";
import { DocumentStep, sendStatus } from "@/app/admin/clients/[id]/setup/document-step";
import { EmailCopyReview } from "@/app/portal/setup/email-copy/email-copy-review";
import {
  EMAIL_SEQUENCE_LABELS,
  asClientEmail,
  asEmailCopy,
  emailCopyHasContent,
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

const hasContent = emailCopyHasContent;

function typedDraftMessage(result: { drafted: string[]; failed: { key: string; error: string }[]; knownLeftOut: number }) {
  const parts = [`Drafted ${result.drafted.length} group${result.drafted.length === 1 ? "" : "s"} and saved.`];
  if (result.failed.length) {
    parts.push(`Not written (kept as before): ${result.failed.map((item) => `${item.key} (${item.error})`).join("; ")}.`);
  }
  if (result.knownLeftOut) {
    parts.push(`${result.knownLeftOut} fund${result.knownLeftOut === 1 ? "" : "s"} the client knows ${result.knownLeftOut === 1 ? "is" : "are"} left out.`);
  }
  parts.push("Edit, then push.");
  return parts.join(" ");
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
  pushWarning = null,
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
  /** Core contacts not written and approved yet: asked about before pushing, not blocking. */
  pushWarning?: string | null;
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
  // Four-tier lists are written by fund type (copy v2). Older copy stays as it was.
  const byType = listScheme === "four";
  const typedMode = copy.copy_version === 2 || (byType && !hasContent(copy));
  const clientNotes = row?.response?.item_notes ?? {};
  // Real leads to preview each email with; reloaded when the groups change.
  const [previewLeads, setPreviewLeads] = useState<PreviewLeads>({});
  const groupsKey = copy.typed ? [...copy.typed.core, ...copy.typed.others].map((g) => g.type).join(",") + copy.typed.core.length : "";
  useEffect(() => {
    if (!groupsKey) return;
    let live = true;
    void loadPreviewLeadsAction(clientId).then((result) => {
      if (live && result.ok) setPreviewLeads(result.leads);
    });
    return () => {
      live = false;
    };
  }, [clientId, groupsKey]);

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
    setCopy(emptyEmailCopy(listScheme));
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
      if (byType) {
        const result = await draftClientTypedCopy(clientId, null);
        if (!result.ok) {
          setMessage({ kind: "error", text: result.error });
          return;
        }
        setCopy(result.copy);
        setSavedKey(JSON.stringify(result.copy));
        setMessage({ kind: result.failed.length ? "error" : "ok", text: typedDraftMessage(result) });
        return;
      }
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

  /** Redrafts one group. Local edits to the other groups are kept. */
  async function onRedraft(key: string) {
    const current = copy.typed;
    if (!current) return;
    if (!window.confirm("Redraft this group with AI? Its emails are replaced; every other group stays as it is.")) return;
    setDrafting(true);
    setMessage(null);
    try {
      const result = await draftClientTypedCopy(clientId, [key]);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      const [section, type] = key.split(":") as ["core" | "others", string];
      const written = result.copy.typed?.[section].find((group) => group.type === type);
      // The server saved its merge; the editor keeps unsaved edits elsewhere.
      setSavedKey(JSON.stringify(result.copy));
      if (written) {
        setCopy((existing) => {
          const typed = existing.typed ?? current;
          return {
            ...existing,
            typed: { ...typed, [section]: typed[section].map((group) => (group.type === type ? written : group)) },
          };
        });
      }
      setMessage({ kind: result.failed.length ? "error" : "ok", text: typedDraftMessage(result) });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Unable to redraft." });
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
      intro={
        byType
          ? "Written by fund type, in the styles set under Emails → Investor email styles. Core: an approach and a template per fund type; each Core contact later gets a personal version from {{quick_fact}}. Sphere, Tier 3 and Tier 4: one sequence per fund type, with a line per tier as {{tier_line}}. Funds the client marked as known are left out."
          : "A first email and two follow-ups for each fit tier. Leave a follow-up subject blank to send it in the same thread. Use placeholders like {{first_name}} and {{fund_name}} for personal details."
      }
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
              : byType
                ? "Draft by fund type"
                : "Draft with AI"}
        </button>
        <p className="text-body-sm text-muted" aria-live="polite">
          {drafting
            ? byType
              ? "Writing the copy for each fund type. Usually under a minute."
              : `Writing the ${tiers.length * 3} emails. Usually under a minute.`
            : !claudeReady
              ? "Claude is not configured (ANTHROPIC_API_KEY)."
              : byType
                ? "Uses the AI Agents → Email copy by fund type instructions."
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
      {byType && !typedMode ? (
        <p role="alert" className="mx-lg mt-md rounded-md border border-warning/40 px-md py-sm text-body-sm text-warning">
          This copy has one sequence per tier. Click Draft by fund type to rewrite it by fund type (it replaces this draft;
          the copy already sent to the client is not changed).
        </p>
      ) : null}
      {schemeMismatch && !typedMode ? (
        <div role="alert" className="mx-lg mt-md rounded-md border border-warning/40 px-md py-sm text-body-sm text-warning">
          This copy has {copyScheme === "four" ? "four" : "three"} tiers; the confirmed investor list has{" "}
          {listScheme === "four" ? "four" : "three"}.{" "}
          <button type="button" className="text-primary underline hover:text-primary-hover" onClick={startListScheme}>
            Start a {listScheme === "four" ? "four" : "three"}-tier copy
          </button>
        </div>
      ) : null}
      {typedMode ? (
        copy.typed ? (
          <TypedCopyEditor
            typed={copy.typed}
            onChange={(typed) => setCopy((current) => ({ ...current, typed }))}
            onRedraft={onRedraft}
            busy={drafting}
            canDraft={claudeReady}
            clientNotes={clientNotes}
            previewLeads={previewLeads}
          />
        ) : (
          <p className="px-lg py-lg text-body-sm text-muted">
            No copy yet. Click Draft by fund type: it groups the confirmed list&apos;s funds by type and writes each group
            in its style.
          </p>
        )
      ) : null}
      <div className="px-lg py-md">
        {typedMode ? null : (<>
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
              <EmailBodyField
                className={inputClass}
                value={email.body}
                onChange={(value) => update(index, "body", value)}
                placeholder="Body"
                label={`${tierName(activeTier)} ${EMAIL_SEQUENCE_LABELS[index]} body`}
              />
            </li>
          ))}
        </ol>

        </>)}
        {pushWarning && problems.length === 0 ? <p className="mt-md text-body-sm text-warning">{pushWarning}</p> : null}
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
        warning={pushWarning}
        busy={drafting}
        pushSummary="Pushes the emails above to the client's portal as a new version, and sends them this email. They confirm there, ask a question, or ask for changes."
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
