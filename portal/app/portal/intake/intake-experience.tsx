"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  confirmIntake,
  createIntakeUpload,
  requestIntakeSummary,
  resumeIntakeConversation,
  sendIntakeFile,
  sendIntakeMessage,
  startIntake,
  type IntakeActionResult,
} from "@/app/portal/intake/actions";
import { BOOK_CALL_URL } from "@/components/book-call-link";
import { RupertAvatar } from "@/components/rupert-avatar";
import { formatDate } from "@/lib/format";
import {
  INTAKE_LIMITS,
  extrasProgress,
  intakeProgress,
  topicCoverage,
  type IntakeInterview,
  type IntakeTopic,
  type TopicCoverage,
} from "@/lib/intake";
import { MATERIALS_BUCKET, fileExtension, formatBytes } from "@/lib/setup";
import { createClient } from "@/lib/supabase/client";

const primaryButton =
  "inline-flex items-center justify-center gap-sm rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const secondaryButton =
  "inline-flex items-center justify-center rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

/** One-tap answers for the most common short replies. */
const QUICK_REPLIES = ["None", "Not sure yet", "Skip this one"];
const TEXTAREA_MAX_PX = 168;

function FileChip({ name, inverse }: { name: string; inverse?: boolean }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-xs rounded-md border px-sm py-xs text-body-sm ${
        inverse ? "border-primary/30 bg-surface text-heading" : "border-border bg-surface text-heading"
      }`}
    >
      <span className="rounded border border-border px-xs text-label uppercase tracking-label text-muted">
        PDF
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

function PaperclipIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="m15.5 9.5-5.6 5.6a3.5 3.5 0 0 1-5-5l6-6a2.3 2.3 0 0 1 3.3 3.3l-6 6a1.2 1.2 0 0 1-1.7-1.7l5.5-5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M10 16V4m0 0-5 5m5-5 5 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const COVERAGE_LABEL: Record<TopicCoverage, string> = {
  covered: "Covered",
  partial: "In progress",
  missing: "To do",
};

function CoverageIcon({ coverage }: { coverage: TopicCoverage }) {
  if (coverage === "covered") {
    return (
      <svg className="h-5 w-5 shrink-0 text-success" viewBox="0 0 20 20" aria-hidden>
        <circle cx="10" cy="10" r="7.25" fill="currentColor" opacity="0.12" />
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6.5 10.25 8.75 12.5l4.75-5"
        />
      </svg>
    );
  }
  if (coverage === "partial") {
    return (
      <svg className="h-5 w-5 shrink-0 text-warning" viewBox="0 0 20 20" aria-hidden>
        <circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 3.5a6.5 6.5 0 0 1 0 13Z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className="h-5 w-5 shrink-0 text-muted" viewBox="0 0 20 20" aria-hidden>
      <circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ProgressRing({ percent }: { percent: number }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percent / 100);
  return (
    <div className="relative h-[88px] w-[88px] shrink-0">
      <svg viewBox="0 0 88 88" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="44" cy="44" r={radius} fill="none" strokeWidth="7" className="stroke-primary-tint" />
        <circle
          cx="44"
          cy="44"
          r={radius}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          className="stroke-primary transition-[stroke-dashoffset] duration-500"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-h4 text-heading">
        {percent}%
      </span>
    </div>
  );
}

function TypingIndicator({ label }: { label?: string }) {
  return (
    <div className="flex items-end gap-sm" aria-live="polite">
      <RupertAvatar size={28} />
      <div className="flex items-center gap-sm rounded-card rounded-bl-none border border-border bg-surface px-md py-sm">
        <span className="sr-only">{label ?? "Rupert is typing"}</span>
        {label ? (
          <span className="text-body-sm text-muted" aria-hidden>
            {label}
          </span>
        ) : null}
        <span className="flex gap-xs" aria-hidden>
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

export function IntakeExperience({
  initialInterview,
  topics,
  completedAt,
  firstName,
  readOnly,
  materialsSubmitted,
}: {
  initialInterview: IntakeInterview | null;
  topics: IntakeTopic[];
  completedAt: string | null;
  firstName: string;
  readOnly: boolean;
  /** Company Materials already submitted, so Setup has started. */
  materialsSubmitted: boolean;
}) {
  const router = useRouter();
  const [interview, setInterview] = useState<IntakeInterview | null>(
    initialInterview,
  );
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<
    "start" | "send" | "upload" | "summary" | "resume" | "confirm" | null
  >(null);
  // Shown in the conversation right away, before Rupert answers.
  const [outgoing, setOutgoing] = useState<{ text: string; file: string | null } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const startedRef = useRef(false);

  // "completed" is the final, read-only state: the client confirmed their
  // summary, or Rupert's team closed the intake before it started.
  const completed =
    interview?.status === "completed" ||
    (Boolean(completedAt) && (!interview || interview.messages.length === 0));
  const topicStatus = interview?.topic_status ?? {};
  const progress = completed
    ? { percent: 100, ready: true }
    : intakeProgress(topics, topicStatus);
  // The essentials are done once every required topic is covered; the intake
  // is then complete for Rupert, and the extras are recommended.
  const essentialsDone = progress.ready || Boolean(completedAt);
  const extras = extrasProgress(topics, topicStatus);
  const messages = interview?.messages ?? [];
  const reviewing = interview?.status === "review" && !completed;
  const limitReached =
    (interview?.client_message_count ?? 0) >= INTAKE_LIMITS.clientMessagesMax;

  function apply(result: IntakeActionResult) {
    if (result.ok) {
      setInterview(result.interview);
      setError(null);
      setAiUnavailable(false);
      return true;
    }
    setError(result.error);
    setAiUnavailable(Boolean(result.aiUnavailable));
    return false;
  }

  async function run(
    kind: NonNullable<typeof pending>,
    action: () => Promise<IntakeActionResult>,
  ) {
    setPending(kind);
    try {
      return apply(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      return false;
    } finally {
      setPending(null);
    }
  }

  // Start the interview the first time the client opens the page.
  useEffect(() => {
    if (startedRef.current || readOnly || completed) return;
    // Only a brand-new interview needs Rupert's opening message.
    if (
      interview &&
      (interview.messages.length > 0 || interview.status !== "in_progress")
    ) {
      return;
    }
    startedRef.current = true;
    void run("start", startIntake);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, pending, outgoing]);

  // The answer box grows with the text, up to a few lines.
  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, TEXTAREA_MAX_PX)}px`;
  }, [draft]);

  useEffect(() => {
    if (interview?.summary) {
      setAnswers(
        Object.fromEntries(
          interview.summary.map((item) => [item.topic_id, item.answer]),
        ),
      );
    }
  }, [interview?.summary]);

  /** Sends a message (or a file) and shows it in the conversation at once. */
  async function deliver(
    kind: "send" | "upload",
    shown: { text: string; file: string | null },
    action: () => Promise<IntakeActionResult>,
  ) {
    const wasReady = progress.ready;
    let nowReady = false;
    setOutgoing(shown);
    setDraft("");
    const sent = await run(kind, async () => {
      const result = await action();
      if (result.ok) {
        nowReady = intakeProgress(topics, result.interview.topic_status).ready;
      }
      return result;
    });
    setOutgoing(null);
    if (!sent) setDraft(shown.text);
    // The essentials just got covered: the intake is now complete, so refresh
    // the sidebar and onboarding counts.
    if (sent && nowReady && !wasReady) router.refresh();
    inputRef.current?.focus();
  }

  async function onSend(event?: React.FormEvent, preset?: string) {
    event?.preventDefault();
    const text = (preset ?? draft).trim();
    if (!text || pending || readOnly || limitReached) return;
    await deliver("send", { text, file: null }, () => sendIntakeMessage(text));
  }

  async function onFile(file: File | undefined) {
    if (!file || pending || readOnly || limitReached) return;
    if (fileExtension(file.name) !== "pdf") {
      setError("Share a PDF here. Other files can be added in Setup.");
      return;
    }
    if (file.size > INTAKE_LIMITS.fileMaxBytes) {
      setError(
        `${file.name} is ${formatBytes(file.size)}. PDFs up to ${formatBytes(INTAKE_LIMITS.fileMaxBytes)} can be shared here; add larger files in Setup.`,
      );
      return;
    }
    const note = draft.trim();
    await deliver("upload", { text: note, file: file.name }, async () => {
      const ticket = await createIntakeUpload({ name: file.name, size: file.size });
      if (!ticket.ok) return ticket;
      const { error: uploadError } = await createClient()
        .storage.from(MATERIALS_BUCKET)
        .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: "application/pdf" });
      if (uploadError) return { ok: false, error: `Upload failed: ${uploadError.message}` };
      return sendIntakeFile({
        path: ticket.path,
        name: file.name,
        size: file.size,
        type: file.type,
        note,
      });
    });
    if (fileRef.current) fileRef.current.value = "";
  }

  const canWrite = !readOnly && !limitReached && pending === null;

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void onSend();
    }
  }

  async function onConfirm() {
    if (!interview?.summary || readOnly) return;
    const ok = await run("confirm", () =>
      confirmIntake(
        interview.summary!.map((item) => ({
          topic_id: item.topic_id,
          answer: answers[item.topic_id] ?? item.answer,
        })),
      ),
    );
    if (ok) router.refresh();
  }

  const topicRow = (topic: IntakeTopic) => {
    const coverage = completed ? "covered" : topicCoverage(topicStatus, topic.id);
    const note = topicStatus[topic.id]?.note;
    return (
      <li
        key={topic.id}
        className="flex gap-sm border-b border-border px-lg py-sm last:border-b-0"
      >
        <CoverageIcon coverage={coverage} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline justify-between gap-x-sm text-body-sm text-heading">
            <span>{topic.title}</span>
            <span className="text-label uppercase tracking-label text-muted">
              {!topic.required && coverage === "missing"
                ? "Optional"
                : COVERAGE_LABEL[coverage]}
            </span>
          </p>
          {note ? (
            <p className="mt-xs line-clamp-2 text-body-sm text-muted">{note}</p>
          ) : null}
        </div>
      </li>
    );
  };

  const essentialTopics = topics.filter((topic) => topic.required);
  const extraTopics = topics.filter((topic) => !topic.required);

  const progressPanel = (
    <aside className="rounded-card border border-border bg-surface lg:sticky lg:top-lg lg:self-start">
      <div className="flex items-center gap-md border-b border-border px-lg py-lg">
        <ProgressRing percent={essentialsDone ? 100 : progress.percent} />
        <div>
          <p className="text-h4 text-heading">
            {completed
              ? "Intake complete"
              : essentialsDone
                ? "Essentials done"
                : "Your intake"}
          </p>
          <p className="mt-xs text-body-sm text-muted">
            {completed
              ? materialsSubmitted
                ? "Thank you. Rupert is on it."
                : "Last step: share your deck and materials."
              : essentialsDone && extras.total > 0
                ? `Extras: ${extras.covered} of ${extras.total} covered`
                : "Progress on the essentials."}
          </p>
        </div>
      </div>
      {essentialTopics.length > 0 ? (
        <>
          <p className="border-b border-border px-lg py-sm text-label uppercase tracking-label text-muted">
            Essentials
          </p>
          <ul>{essentialTopics.map(topicRow)}</ul>
        </>
      ) : null}
      {extraTopics.length > 0 ? (
        <>
          <p className="border-y border-border px-lg py-sm text-label uppercase tracking-label text-muted">
            Extras (recommended)
          </p>
          <ul>{extraTopics.map(topicRow)}</ul>
        </>
      ) : null}
      {!completed && !reviewing ? (
        <div className="border-t border-border px-lg py-md">
          <button
            type="button"
            className={`${essentialsDone ? secondaryButton : primaryButton} w-full`}
            disabled={!progress.ready || pending !== null || readOnly}
            onClick={() => void run("summary", requestIntakeSummary)}
          >
            {pending === "summary" ? "Writing your summary…" : "Review summary"}
          </button>
          <p className="mt-sm text-center text-body-sm text-muted">
            {progress.ready
              ? "Optional. Rupert already has what he needs."
              : "Opens once the essentials are covered."}
          </p>
        </div>
      ) : null}
    </aside>
  );

  const errorBlock = error ? (
    <div role="alert" className="mt-sm text-body-sm text-error">
      {error}
      {aiUnavailable ? (
        <>
          {" "}
          <a
            href={BOOK_CALL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary no-underline hover:text-primary-hover"
          >
            Book a call
          </a>
        </>
      ) : null}
    </div>
  ) : null;

  if (completed) {
    return (
      <div className="grid gap-lg lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-card border border-border bg-surface p-lg">
          <div className="flex items-center gap-md">
            <RupertAvatar size={56} />
            <div>
              <h2 className="text-h4">
                Thank you{firstName ? `, ${firstName}` : ""}.
              </h2>
              <p className="mt-xs text-body-sm text-muted">
                Intake confirmed
                {completedAt ? ` on ${formatDate(completedAt)}` : ""}.
                {materialsSubmitted
                  ? " Rupert is on it."
                  : " One step left in onboarding."}
              </p>
            </div>
          </div>
          {materialsSubmitted ? null : (
            <div className="mt-lg flex flex-wrap items-center justify-between gap-md rounded-card border border-primary/30 bg-primary-tint px-lg py-md">
              <div>
                <p className="text-label uppercase tracking-label text-primary">
                  Your turn
                </p>
                <p className="mt-xs text-body-sm text-heading">
                  Last step: share your deck and materials
                </p>
              </div>
              <Link
                href="/portal/materials"
                className="rounded-md bg-primary px-md py-sm text-body-sm text-white no-underline transition-colors duration-hover hover:bg-primary-hover"
              >
                Share materials
              </Link>
            </div>
          )}
          {interview?.summary ? (
            <dl className="mt-lg divide-y divide-border border-t border-border">
              {interview.summary.map((item) => (
                <div key={item.topic_id} className="py-md">
                  <dt className="text-label uppercase tracking-label text-muted">
                    {item.title}
                  </dt>
                  <dd className="mt-xs whitespace-pre-wrap text-body-sm text-body">
                    {item.answer}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>
        {progressPanel}
      </div>
    );
  }

  if (reviewing && interview?.summary) {
    return (
      <div className="grid gap-lg lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-card border border-border bg-surface">
          <div className="flex items-center gap-md border-b border-border px-lg py-lg">
            <RupertAvatar size={48} />
            <div>
              <h2 className="text-h4">Here is what I gathered</h2>
              <p className="mt-xs text-body-sm text-muted">
                Edit anything that is off, then confirm. This is what Rupert
                will work from.
              </p>
            </div>
          </div>
          <div className="divide-y divide-border">
            {interview.summary.map((item) => (
              <label key={item.topic_id} className="block px-lg py-md">
                <span className="text-label uppercase tracking-label text-muted">
                  {item.title}
                </span>
                <textarea
                  className="mt-sm min-h-[88px] w-full resize-y rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary disabled:opacity-60"
                  value={answers[item.topic_id] ?? item.answer}
                  maxLength={INTAKE_LIMITS.messageMaxChars}
                  disabled={readOnly || pending !== null}
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [item.topic_id]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-sm border-t border-border px-lg py-md">
            <button
              type="button"
              className={primaryButton}
              disabled={readOnly || pending !== null}
              onClick={() => void onConfirm()}
            >
              {pending === "confirm" ? "Confirming…" : "Confirm intake"}
            </button>
            <button
              type="button"
              className={secondaryButton}
              disabled={readOnly || pending !== null}
              onClick={() => void run("resume", resumeIntakeConversation)}
            >
              Back to the conversation
            </button>
            {readOnly ? (
              <p className="text-body-sm text-muted">Read-only preview.</p>
            ) : null}
          </div>
          {errorBlock ? <div className="px-lg pb-md">{errorBlock}</div> : null}
        </section>
        {progressPanel}
      </div>
    );
  }

  const essentialsBanner = essentialsDone ? (
    <section
      role="status"
      className="mb-lg flex flex-wrap items-start gap-md rounded-card border border-primary/30 bg-primary-tint px-lg py-md"
    >
      <CoverageIcon coverage="covered" />
      <div className="min-w-0 flex-1">
        <p className="text-body-sm text-heading">
          <span className="font-medium">
            {extras.done
              ? "Everything is covered. Thank you."
              : "The essentials are done."}
          </span>{" "}
          {extras.done
            ? "Rupert has everything he needs. You can review your summary anytime."
            : "Rupert has what he needs to start, and your intake is marked complete. A few more minutes on the extras can make your campaign noticeably sharper. We recommend it."}
        </p>
        <div className="mt-sm flex flex-wrap items-center gap-md">
          {!extras.done ? (
            <button
              type="button"
              className={primaryButton}
              disabled={readOnly || limitReached}
              onClick={() => inputRef.current?.focus()}
            >
              Continue with Rupert
            </button>
          ) : null}
          {progress.ready ? (
            <button
              type="button"
              className="text-body-sm text-primary hover:text-primary-hover disabled:opacity-40"
              disabled={readOnly || pending !== null}
              onClick={() => void run("summary", requestIntakeSummary)}
            >
              Review summary
            </button>
          ) : null}
        </div>
      </div>
    </section>
  ) : null;

  return (
    <>
      {essentialsBanner}
      <div className="grid gap-lg lg:grid-cols-[minmax(0,1fr)_320px]">
        <section
          className="relative flex h-[min(74vh,780px)] min-h-[480px] flex-col rounded-card border border-border bg-surface"
          onDragOver={(event) => {
            if (!canWrite || !event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setDragging(false);
          }}
          onDrop={(event) => {
            if (!canWrite) return;
            event.preventDefault();
            setDragging(false);
            void onFile(event.dataTransfer.files?.[0]);
          }}
        >
          <header className="flex items-center gap-md border-b border-border px-lg py-md">
            <RupertAvatar size={44} />
            <div className="min-w-0 flex-1">
              <p className="text-body-sm text-heading">Rupert</p>
              <p className="text-body-sm text-muted">Researcher, Hey Rupert</p>
            </div>
            <div className="w-28 shrink-0 lg:hidden" aria-hidden>
              <div className="h-1.5 overflow-hidden rounded-full bg-primary-tint">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <p className="mt-xs text-right font-mono text-mono text-muted">
                {progress.percent}%
              </p>
            </div>
          </header>

          <div
            ref={scrollRef}
            className="flex-1 space-y-md overflow-y-auto overscroll-contain px-lg py-lg"
            aria-live="polite"
          >
            {messages.map((message, index) =>
              message.role === "assistant" ? (
                <div key={index} className="flex items-end gap-sm">
                  <RupertAvatar size={28} />
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-card rounded-bl-none border border-border bg-background px-md py-sm text-body-sm leading-relaxed text-body">
                    {message.content}
                  </p>
                </div>
              ) : (
                <div key={index} className="flex flex-col items-end gap-xs">
                  {message.attachment ? <FileChip name={message.attachment.name} inverse /> : null}
                  {message.content ? (
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-card rounded-br-none bg-primary-tint px-md py-sm text-body-sm leading-relaxed text-heading">
                      {message.content}
                    </p>
                  ) : null}
                </div>
              ),
            )}
            {outgoing ? (
              <div className="flex flex-col items-end gap-xs opacity-80">
                {outgoing.file ? <FileChip name={outgoing.file} inverse /> : null}
                {outgoing.text ? (
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-card rounded-br-none bg-primary-tint px-md py-sm text-body-sm leading-relaxed text-heading">
                    {outgoing.text}
                  </p>
                ) : null}
              </div>
            ) : null}
            {pending === "start" || pending === "send" ? <TypingIndicator /> : null}
            {pending === "upload" ? (
              <TypingIndicator label="Reading your file. This can take up to a minute." />
            ) : null}
            {messages.length === 0 && pending === null && readOnly ? (
              <p className="text-center text-body-sm text-muted">
                The client has not started the interview yet.
              </p>
            ) : null}
          </div>

          <form onSubmit={onSend} className="border-t border-border px-lg py-md">
            {canWrite && messages.length > 0 && messages[messages.length - 1].role === "assistant" ? (
              <div className="mb-sm flex flex-wrap gap-xs" aria-label="Quick replies">
                {QUICK_REPLIES.map((reply) => (
                  <button
                    key={reply}
                    type="button"
                    className="min-h-[32px] rounded-full border border-border bg-background px-sm text-body-sm text-secondary transition-colors duration-hover hover:border-primary hover:text-primary"
                    onClick={() => void onSend(undefined, reply)}
                  >
                    {reply}
                  </button>
                ))}
              </div>
            ) : null}
            <label htmlFor="intake-message" className="sr-only">
              Your answer
            </label>
            <div className="flex items-end gap-xs rounded-card border border-border bg-background px-xs py-xs focus-within:border-primary">
              <input
                ref={fileRef}
                id="intake-file"
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => void onFile(event.target.files?.[0])}
              />
              <button
                type="button"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-hover hover:bg-surface hover:text-heading disabled:opacity-40"
                aria-label="Share a PDF (your deck or one-pager)"
                title="Share a PDF (your deck or one-pager)"
                disabled={!canWrite}
                onClick={() => fileRef.current?.click()}
              >
                <PaperclipIcon />
              </button>
              <textarea
                ref={inputRef}
                id="intake-message"
                rows={1}
                value={draft}
                maxLength={INTAKE_LIMITS.messageMaxChars}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                disabled={readOnly || limitReached || pending === "start"}
                placeholder={
                  readOnly
                    ? "Read-only preview"
                    : limitReached
                      ? "Message limit reached"
                      : "Type your answer…"
                }
                className="max-h-[168px] min-h-[40px] flex-1 resize-none bg-transparent px-xs py-sm text-body-sm text-body outline-none disabled:opacity-60"
              />
              <button
                type="submit"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40"
                aria-label="Send"
                disabled={!draft.trim() || !canWrite}
              >
                <SendIcon />
              </button>
            </div>
            <p className="mt-xs flex justify-between gap-sm text-body-sm text-muted">
              <span>Enter to send · Shift+Enter for a new line · Drop a PDF to share your deck</span>
              {draft.length > INTAKE_LIMITS.messageMaxChars * 0.8 ? (
                <span className="font-mono text-mono">
                  {draft.length}/{INTAKE_LIMITS.messageMaxChars}
                </span>
              ) : null}
            </p>
            {errorBlock}
            {aiUnavailable && messages.length === 0 && !readOnly ? (
              <button
                type="button"
                className={`${secondaryButton} mt-sm`}
                disabled={pending !== null}
                onClick={() => void run("start", startIntake)}
              >
                Try again
              </button>
            ) : null}
          </form>

          {dragging ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-card border-2 border-dashed border-primary bg-surface/90">
              <p className="text-body-sm text-heading">Drop your PDF to share it with Rupert</p>
            </div>
          ) : null}
        </section>
        {progressPanel}
      </div>
    </>
  );
}
