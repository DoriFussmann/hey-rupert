"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { draftClientNudge, sendClientNudge } from "@/app/admin/nudge-actions";
import {
  inputClass,
  primaryButton,
  secondaryButton,
} from "@/app/admin/clients/[id]/setup/shared";
import { formatDateAtTime } from "@/lib/format";
import { daysLabel, type NudgeDetail, type NudgeHistoryEntry, type NudgeTurn } from "@/lib/nudge";
import { EMAIL_BODY_MAX, EMAIL_SUBJECT_MAX, type ClientEmailDraft } from "@/lib/setup";

const labelClass = "block text-label uppercase tracking-label text-muted";

type Pending = null | "draft" | "send";
type Message = { kind: "ok" | "error"; text: string } | null;

function errorText(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function History({ entries }: { entries: NudgeHistoryEntry[] }) {
  const thisRound = entries.filter((entry) => entry.thisRound).length;
  if (entries.length === 0) {
    return <p className="mt-md text-body-sm text-muted">Not nudged or reminded on this step yet.</p>;
  }
  return (
    <details className="mt-md rounded-md border border-border bg-background px-md py-sm">
      <summary className="cursor-pointer text-body-sm text-heading">
        Nudged and reminded {entries.length} time{entries.length === 1 ? "" : "s"} · {thisRound} this round
      </summary>
      <ol className="mt-sm divide-y divide-border">
        {entries.map((entry) => (
          <li key={entry.id} className="py-sm text-body-sm">
            <p className="text-label uppercase tracking-label text-muted">
              {entry.kind === "nudge" ? "Your nudge" : "Automatic reminder"} ·{" "}
              {formatDateAtTime(entry.created_at)} · {entry.thisRound ? "this round" : "earlier"}
              {entry.status === "failed" ? " · not delivered" : ""}
            </p>
            <p className="mt-xs text-heading">{entry.subject}</p>
            <details className="mt-xs">
              <summary className="cursor-pointer text-primary hover:text-primary-hover">Show email</summary>
              <p className="mt-xs whitespace-pre-wrap text-body">{entry.body}</p>
            </details>
          </li>
        ))}
      </ol>
    </details>
  );
}

function NudgeEditor({
  clientId,
  turn,
  to,
}: {
  clientId: string;
  turn: NudgeTurn;
  to: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState<ClientEmailDraft>({ subject: "", body: "" });
  const [pending, setPending] = useState<Pending>(null);
  const [pausedNote, setPausedNote] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const hasText = Boolean(email.subject.trim() || email.body.trim());

  async function onDraft() {
    if (hasText && !window.confirm("Replace the subject and email with a new draft?")) return;
    setPending("draft");
    setMessage(null);
    try {
      const result = await draftClientNudge(clientId, turn.key);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setEmail(result.email);
      setPausedNote(result.pausedNote);
      setMessage({ kind: "ok", text: "Nudge drafted. Read it through and edit it before sending." });
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "Unable to draft the nudge.") });
    } finally {
      setPending(null);
    }
  }

  async function onSend() {
    if (!email.subject.trim() || !email.body.trim()) {
      setMessage({ kind: "error", text: "Add a subject and the email first." });
      return;
    }
    if (!window.confirm(`Send this nudge to ${to}?`)) return;
    setPending("send");
    setMessage(null);
    try {
      const result = await sendClientNudge(clientId, turn.key, email);
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      if (!result.sent.ok) {
        setMessage({ kind: "error", text: `Not sent: ${result.sent.reason}` });
        return;
      }
      setMessage({
        kind: result.warning ? "error" : "ok",
        text: result.warning ?? "Nudge sent. It is in the history above and in the client's email history.",
      });
      setEmail({ subject: "", body: "" });
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: errorText(err, "Unable to send the nudge.") });
    } finally {
      setPending(null);
    }
  }

  async function copy(value: string, what: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage({ kind: "ok", text: `${what} copied.` });
    } catch {
      setMessage({ kind: "error", text: `Could not copy the ${what.toLowerCase()}. Select it and copy by hand.` });
    }
  }

  const locked = pending !== null;

  return (
    <div className="mt-md border-t border-border pt-md">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <p className="text-body-sm text-muted">To {to}. Nothing goes out until you click Send.</p>
        <button type="button" className={secondaryButton} disabled={locked} onClick={onDraft}>
          {pending === "draft" ? "Drafting…" : hasText ? "Redraft" : "Draft nudge"}
        </button>
      </div>
      {pausedNote ? <p className="mt-sm text-body-sm text-warning">{pausedNote}</p> : null}
      <label className={`${labelClass} mt-md`}>
        Subject
        <input
          className={`${inputClass} mt-sm normal-case tracking-normal`}
          value={email.subject}
          maxLength={EMAIL_SUBJECT_MAX}
          onChange={(event) => setEmail({ ...email, subject: event.target.value })}
        />
      </label>
      <label className={`${labelClass} mt-md`}>
        Email
        <textarea
          className={`${inputClass} mt-sm min-h-[240px] resize-y normal-case tracking-normal`}
          value={email.body}
          maxLength={EMAIL_BODY_MAX}
          placeholder="Click Draft nudge to write one from where this step stands and what was already sent."
          onChange={(event) => setEmail({ ...email, body: event.target.value })}
        />
      </label>
      <div className="mt-md flex flex-wrap items-center gap-sm">
        <button type="button" className={primaryButton} disabled={locked || !hasText} onClick={onSend}>
          {pending === "send" ? "Sending…" : "Send nudge"}
        </button>
        <button
          type="button"
          className={secondaryButton}
          disabled={locked || !email.subject.trim()}
          onClick={() => void copy(email.subject, "Subject")}
        >
          Copy subject
        </button>
        <button
          type="button"
          className={secondaryButton}
          disabled={locked || !email.body.trim()}
          onClick={() => void copy(email.body, "Email")}
        >
          Copy email
        </button>
      </div>
      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`mt-sm text-body-sm ${message.kind === "ok" ? "text-success" : "text-error"}`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

/** One client: where they stand, what waits on whom, past nudges, and the nudge editor. */
export function NudgeWorkspace({ detail }: { detail: NudgeDetail }) {
  const [openKey, setOpenKey] = useState<string | null>(
    detail.clientTurns.length === 1 ? detail.clientTurns[0].key : null,
  );

  return (
    <div className="grid gap-lg">
      <section className="rounded-card border border-border bg-surface px-lg py-md">
        <div className="flex flex-wrap items-start justify-between gap-md">
          <div className="min-w-0">
            <h2 className="text-h3 text-heading">{detail.name}</h2>
            <p className="mt-xs text-body-sm text-muted">
              {[detail.company !== detail.name ? detail.company : "", detail.email || "No email address"]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-sm">
            <span className="inline-flex whitespace-nowrap rounded-full bg-primary-tint px-sm py-xs text-body-sm text-heading">
              {detail.stageLabel}
            </span>
            <Link
              href={`/admin/clients/${detail.id}`}
              className="text-body-sm text-primary hover:text-primary-hover"
            >
              Open client
            </Link>
          </div>
        </div>
        <p className="mt-md text-body-sm text-heading">
          {detail.clientTurns.length > 0 && detail.ourItems.length > 0
            ? "Both sides have something open."
            : detail.clientTurns.length > 0
              ? "Their turn."
              : detail.ourItems.length > 0
                ? "Your turn. Nothing is waiting on the client."
                : "Nothing is open."}
        </p>
        {detail.paused ? (
          <p className="mt-xs text-body-sm text-warning">
            Automatic emails and reminders are paused for this client. Nudges still go out when you send them.
          </p>
        ) : null}
        {detail.historyError ? (
          <p className="mt-xs text-body-sm text-warning">{detail.historyError}</p>
        ) : null}
      </section>

      {detail.clientTurns.length > 0 ? (
        <section aria-labelledby="nudge-client-turns">
          <h3 id="nudge-client-turns" className="mb-sm text-h4 text-heading">
            Waiting on the client
          </h3>
          <div className="grid gap-md">
            {detail.clientTurns.map((turn) => (
              <article key={turn.key} className="rounded-card border border-border bg-surface px-lg py-md">
                <div className="flex flex-wrap items-start justify-between gap-md">
                  <div className="min-w-0">
                    <p className="text-label uppercase tracking-label text-muted">{turn.label}</p>
                    <p className="mt-xs text-body text-heading">They need to {turn.task}.</p>
                    <p className="mt-xs text-body-sm text-secondary">
                      Waiting {daysLabel(turn.days)} · since {formatDateAtTime(turn.since)}
                    </p>
                    {turn.facts.length > 0 ? (
                      <p className="mt-xs text-body-sm text-muted">{turn.facts.join(" · ")}</p>
                    ) : null}
                  </div>
                  {openKey !== turn.key ? (
                    <button
                      type="button"
                      className={secondaryButton}
                      disabled={!detail.email}
                      onClick={() => setOpenKey(turn.key)}
                    >
                      Nudge
                    </button>
                  ) : null}
                </div>
                <History entries={detail.history[turn.key] ?? []} />
                {openKey === turn.key && detail.email ? (
                  <NudgeEditor clientId={detail.id} turn={turn} to={detail.email} />
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {detail.ourItems.length > 0 ? (
        <section aria-labelledby="nudge-our-turn">
          <h3 id="nudge-our-turn" className="mb-sm text-h4 text-heading">
            Your turn
          </h3>
          <ul className="divide-y divide-border rounded-card border border-primary/30 bg-primary-tint">
            {detail.ourItems.map((item) => (
              <li key={item.action} className="px-lg py-sm text-body-sm">
                <span className="text-heading">{item.action}</span>
                {item.since ? (
                  <span className="text-secondary">
                    {" "}
                    · open {daysLabel(item.days)}, since {formatDateAtTime(item.since)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
