"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { settleSetupQuestion } from "@/app/admin/setup-actions";
import { formatDateAtTime } from "@/lib/format";
import {
  NOTE_MAX,
  isOpenQuestion,
  questionsOf,
  type SetupDocumentStep,
  type SetupItem,
  type SetupQuestion,
  type SetupResponse,
  type SetupStepId,
  type SetupStepState,
} from "@/lib/setup";

export const primaryButton =
  "rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
export const secondaryButton =
  "rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";
export const inputClass =
  "w-full rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary";

/** Why Rupert cannot push a step yet, in Rupert's words. */
export const ADMIN_BLOCKED: Record<SetupStepId, string> = {
  materials: "Waiting for the client's materials",
  deck_review: "The feedback now goes with the outreach narrative",
  framing: "Push opens once the client's intake and materials are in",
  investor_list: "Push opens once the client confirms the outreach narrative",
  email_copy: "Push opens once the client confirms the investor list",
  go_live: "Opens once the client confirms the email copy",
};

/** The step's status from Rupert's side. */
export function adminStatus(item: SetupItem) {
  if (item.status === "done") return { label: "Done", tone: "text-success" };
  if (item.status === "waiting") {
    return { label: "Your turn", tone: "bg-primary-tint text-primary border-primary/30" };
  }
  if (item.status === "your_turn") {
    return { label: "Waiting on client", tone: "text-muted" };
  }
  return { label: "Not open yet", tone: "text-muted" };
}

export function StepFrame({
  item,
  intro,
  action,
  children,
}: {
  item: SetupItem;
  /** One line under the title. Left out for a one-line header. */
  intro?: string;
  /** The step's main button (Analyze, Build narrative), beside the status. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const status = adminStatus(item);
  return (
    <section
      id={`setup-${item.id}`}
      className={`mt-lg rounded-card border bg-surface ${
        item.status === "waiting" ? "border-primary/30" : "border-border"
      }`}
    >
      <div
        className={`flex flex-wrap justify-between gap-md border-b border-border px-lg py-lg ${
          intro ? "items-start" : "items-center"
        }`}
      >
        <div className="min-w-0">
          <h3 className="text-h4">{item.title}</h3>
          {intro ? <p className="mt-xs max-w-prose text-body-sm text-muted">{intro}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-sm">
          <span
            className={`inline-flex rounded-full border border-border px-sm py-xs text-label uppercase tracking-label ${status.tone}`}
          >
            {status.label}
          </span>
          {action}
        </div>
      </div>
      <div className={item.status === "open" ? "opacity-60" : undefined}>{children}</div>
    </section>
  );
}

/** The client's latest answer on the current version, for Rupert. */
export function ClientAnswer({
  row,
  hideWaiting = false,
}: {
  row: SetupStepState | null;
  /** Leave out the "waiting for the client" line (the panel says it already). */
  hideWaiting?: boolean;
}) {
  const response: SetupResponse | null =
    row?.response && row.response.version === row.version ? row.response : null;
  if (!row || row.version === 0) return null;

  if (!response) {
    return row.status === "with_client" && !hideWaiting ? (
      <p className="px-lg pt-md text-body-sm text-muted">
        Version {row.version} pushed {row.published_at ? formatDateAtTime(row.published_at) : ""}.
        Waiting for the client to confirm or comment.
      </p>
    ) : null;
  }

  const notes = Object.entries(response.item_notes);
  const confirmed = response.decision === "confirmed";
  return (
    <div
      className={`mx-lg mt-md rounded-card border px-md py-md ${
        confirmed ? "border-border bg-background" : "border-warning/40 bg-background"
      }`}
    >
      <p
        className={`text-label uppercase tracking-label ${confirmed ? "text-success" : "text-warning"}`}
      >
        {confirmed ? "Client confirmed" : "Client asked for changes"} · version{" "}
        {response.version} · {formatDateAtTime(response.at)}
      </p>
      {response.note ? (
        <p className="mt-xs whitespace-pre-wrap text-body-sm text-body">{response.note}</p>
      ) : null}
      {notes.length > 0 ? (
        <ul className="mt-sm list-disc space-y-xs pl-md text-body-sm text-body">
          {notes.map(([key, note]) => (
            <li key={key}>
              <span className="text-heading">{response.item_labels[key] ?? key}:</span>{" "}
              <span className="whitespace-pre-wrap">{note}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function EarlierRounds({ row }: { row: SetupStepState | null }) {
  const earlier = (row?.history ?? [])
    .filter((entry) => row && entry.version < row.version)
    .sort((a, b) => b.version - a.version);
  if (earlier.length === 0) return null;
  return (
    <details className="mx-lg mt-md text-body-sm">
      <summary className="cursor-pointer text-label uppercase tracking-label text-muted">
        Earlier rounds ({earlier.length})
      </summary>
      <ol className="mt-sm space-y-sm">
        {earlier.map((entry) => (
          <li key={entry.version}>
            <p className="text-muted">
              Version {entry.version} · pushed {formatDateAtTime(entry.published_at)}
              {entry.response
                ? ` · ${entry.response.decision === "confirmed" ? "confirmed" : "changes requested"} ${formatDateAtTime(entry.response.at)}`
                : ""}
            </p>
            {entry.response?.note ? (
              <p className="whitespace-pre-wrap text-body">{entry.response.note}</p>
            ) : null}
            {entry.response
              ? Object.entries(entry.response.item_notes).map(([key, note]) => (
                  <p key={key} className="text-body">
                    <span className="text-heading">
                      {entry.response!.item_labels[key] ?? key}:
                    </span>{" "}
                    {note}
                  </p>
                ))
              : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

function QuestionItem({
  clientId,
  step,
  question,
}: {
  clientId: string;
  step: SetupDocumentStep;
  question: SetupQuestion;
}) {
  const router = useRouter();
  const [answer, setAnswer] = useState("");
  const [pending, setPending] = useState<null | "answer" | "resolve">(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const open = isOpenQuestion(question);

  async function settle(kind: "answer" | "resolve") {
    if (kind === "answer" && !answer.trim()) {
      setMessage({ kind: "error", text: "Write your answer first." });
      return;
    }
    setPending(kind);
    setMessage(null);
    try {
      const result = await settleSetupQuestion(clientId, step, question.id, kind === "answer" ? answer : "");
      if (!result.ok) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setMessage(
        kind === "resolve"
          ? { kind: "ok", text: "Marked resolved. No email was sent." }
          : result.clientEmail.ok
            ? { kind: "ok", text: "Answer sent. It is on their page and in their inbox." }
            : { kind: "error", text: `Answer saved on their page, but the email was not sent: ${result.clientEmail.reason}` },
      );
      setAnswer("");
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Unable to save." });
    } finally {
      setPending(null);
    }
  }

  return (
    <li className={`rounded-md border px-md py-sm ${open ? "border-primary/30 bg-primary-tint" : "border-border bg-background"}`}>
      <p className="text-label uppercase tracking-label text-muted">
        {open ? "Open question" : question.answered_at ? "Answered" : "Resolved"} · version {question.version}
        {question.asked_at ? ` · asked ${formatDateAtTime(question.asked_at)}` : ""}
      </p>
      <p className="mt-xs whitespace-pre-wrap text-body-sm text-heading">{question.question}</p>
      {question.answer ? (
        <p className="mt-sm whitespace-pre-wrap text-body-sm text-body">
          <span className="text-muted">Your answer{question.answered_at ? `, ${formatDateAtTime(question.answered_at)}` : ""}: </span>
          {question.answer}
        </p>
      ) : null}
      {!question.answer && question.resolved_at ? (
        <p className="mt-xs text-body-sm text-muted">Resolved {formatDateAtTime(question.resolved_at)} without a written answer.</p>
      ) : null}
      {open ? (
        <div className="mt-sm">
          <label className="block text-label uppercase tracking-label text-muted">
            Answer
            <textarea
              className={`${inputClass} mt-xs min-h-[80px] resize-y normal-case tracking-normal`}
              value={answer}
              maxLength={NOTE_MAX}
              disabled={pending !== null}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="Shown on their page and emailed to them. The page stays theirs to confirm."
            />
          </label>
          <div className="mt-sm flex flex-wrap items-center gap-sm">
            <button type="button" className={primaryButton} disabled={pending !== null} onClick={() => void settle("answer")}>
              {pending === "answer" ? "Sending…" : "Send Answer"}
            </button>
            <button type="button" className={secondaryButton} disabled={pending !== null} onClick={() => void settle("resolve")}>
              {pending === "resolve" ? "Saving…" : "Mark Resolved"}
            </button>
          </div>
        </div>
      ) : null}
      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`mt-sm text-body-sm ${message.kind === "ok" ? "text-success" : "text-error"}`}
        >
          {message.text}
        </p>
      ) : null}
    </li>
  );
}

/**
 * The client's questions on a review step, newest first: answer one (they
 * are emailed) or mark it resolved. Answering never changes the turn.
 */
export function ClientQuestions({
  clientId,
  step,
  row,
}: {
  clientId: string;
  step: SetupDocumentStep;
  row: SetupStepState | null;
}) {
  const questions = [...questionsOf(row)].reverse();
  if (questions.length === 0) return null;
  const openCount = questions.filter(isOpenQuestion).length;
  return (
    <section className="mx-lg mt-md">
      <p className="text-label uppercase tracking-label text-muted">
        Client questions{openCount > 0 ? ` · ${openCount} waiting for you` : ""}
      </p>
      <ul className="mt-sm space-y-sm">
        {questions.map((question) => (
          <QuestionItem key={question.id} clientId={clientId} step={step} question={question} />
        ))}
      </ul>
    </section>
  );
}
