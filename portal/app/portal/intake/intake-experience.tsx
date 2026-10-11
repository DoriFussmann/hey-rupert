"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  confirmIntake,
  requestIntakeSummary,
  resumeIntakeConversation,
  sendIntakeMessage,
  startIntake,
  type IntakeActionResult,
} from "@/app/portal/intake/actions";
import { BOOK_CALL_URL } from "@/components/book-call-link";
import { RupertAvatar } from "@/components/rupert-avatar";
import { formatDate } from "@/lib/format";
import {
  INTAKE_LIMITS,
  intakeProgress,
  topicCoverage,
  type IntakeInterview,
  type IntakeTopic,
  type TopicCoverage,
} from "@/lib/intake";

const primaryButton =
  "inline-flex items-center justify-center gap-sm rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const secondaryButton =
  "inline-flex items-center justify-center rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

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

function TypingIndicator() {
  return (
    <div className="flex items-end gap-sm" aria-live="polite">
      <RupertAvatar size={28} />
      <div className="rounded-card rounded-bl-none border border-border bg-surface px-md py-sm">
        <span className="sr-only">Rupert is typing</span>
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
}: {
  initialInterview: IntakeInterview | null;
  topics: IntakeTopic[];
  completedAt: string | null;
  firstName: string;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [interview, setInterview] = useState<IntakeInterview | null>(
    initialInterview,
  );
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<
    "start" | "send" | "summary" | "resume" | "confirm" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  const completed = Boolean(completedAt) || interview?.status === "completed";
  const topicStatus = interview?.topic_status ?? {};
  const progress = completed
    ? { percent: 100, ready: true }
    : intakeProgress(topics, topicStatus);
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
  }, [messages.length, pending]);

  useEffect(() => {
    if (interview?.summary) {
      setAnswers(
        Object.fromEntries(
          interview.summary.map((item) => [item.topic_id, item.answer]),
        ),
      );
    }
  }, [interview?.summary]);

  async function onSend(event?: React.FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || pending || readOnly) return;
    const sent = await run("send", () => sendIntakeMessage(text));
    if (sent) setDraft("");
  }

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

  const progressPanel = (
    <aside className="rounded-card border border-border bg-surface lg:sticky lg:top-lg lg:self-start">
      <div className="flex items-center gap-md border-b border-border px-lg py-lg">
        <ProgressRing percent={progress.percent} />
        <div>
          <p className="text-h4 text-heading">
            {completed
              ? "Intake complete"
              : progress.ready
                ? "All set to review"
                : "Your intake"}
          </p>
          <p className="mt-xs text-body-sm text-muted">
            {completed
              ? "Thank you. Rupert is on it."
              : "Progress on required topics."}
          </p>
        </div>
      </div>
      <ul>
        {topics.map((topic) => {
          const coverage = completed ? "covered" : topicCoverage(topicStatus, topic.id);
          const note = topicStatus[topic.id]?.note;
          return (
            <li key={topic.id} className="flex gap-sm border-b border-border px-lg py-sm last:border-b-0">
              <CoverageIcon coverage={coverage} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline justify-between gap-x-sm text-body-sm text-heading">
                  <span>{topic.title}</span>
                  <span className="text-label uppercase tracking-label text-muted">
                    {topic.required ? COVERAGE_LABEL[coverage] : "Optional"}
                  </span>
                </p>
                {note ? (
                  <p className="mt-xs line-clamp-2 text-body-sm text-muted">{note}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {!completed && !reviewing ? (
        <div className="border-t border-border px-lg py-md">
          <button
            type="button"
            className={`${primaryButton} w-full`}
            disabled={!progress.ready || pending !== null || readOnly}
            onClick={() => void run("summary", requestIntakeSummary)}
          >
            {pending === "summary" ? "Writing your summary…" : "Review summary"}
          </button>
          {!progress.ready ? (
            <p className="mt-sm text-center text-body-sm text-muted">
              Opens once the required topics are covered.
            </p>
          ) : null}
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
                {completedAt ? ` on ${formatDate(completedAt)}` : ""}. Rupert
                has everything he needs to start Setup.
              </p>
            </div>
          </div>
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

  return (
    <div className="grid gap-lg lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="flex h-[min(72vh,760px)] min-h-[480px] flex-col rounded-card border border-border bg-surface">
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
                <p className="max-w-[85%] whitespace-pre-wrap rounded-card rounded-bl-none border border-border bg-background px-md py-sm text-body-sm text-body">
                  {message.content}
                </p>
              </div>
            ) : (
              <div key={index} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-card rounded-br-none bg-primary-tint px-md py-sm text-body-sm text-heading">
                  {message.content}
                </p>
              </div>
            ),
          )}
          {pending === "start" || pending === "send" ? <TypingIndicator /> : null}
          {messages.length === 0 && pending === null && readOnly ? (
            <p className="text-center text-body-sm text-muted">
              The client has not started the interview yet.
            </p>
          ) : null}
        </div>

        <form onSubmit={onSend} className="border-t border-border px-lg py-md">
          {progress.ready ? (
            <p className="mb-sm rounded-md bg-primary-tint px-sm py-xs text-body-sm text-heading">
              Required topics are covered. Add anything else, or review your
              summary.
            </p>
          ) : null}
          <label htmlFor="intake-message" className="sr-only">
            Your answer
          </label>
          <div className="flex items-end gap-sm">
            <textarea
              id="intake-message"
              rows={2}
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
              className="min-h-[52px] flex-1 resize-y rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary disabled:opacity-60"
            />
            <button
              type="submit"
              className={primaryButton}
              disabled={!draft.trim() || pending !== null || readOnly || limitReached}
            >
              {pending === "send" ? "Sending…" : "Send"}
            </button>
          </div>
          <p className="mt-xs flex justify-between text-body-sm text-muted">
            <span>Enter to send · Shift+Enter for a new line</span>
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
      </section>
      {progressPanel}
    </div>
  );
}
