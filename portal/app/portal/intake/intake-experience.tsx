"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  confirmIntake,
  createIntakeUpload,
  declareNoDeck,
  requestIntakeSummary,
  resumeIntakeConversation,
  sendIntakeFiles,
  sendIntakeMessage,
  startIntake,
  type IntakeActionResult,
} from "@/app/portal/intake/actions";
import { BOOK_CALL_URL } from "@/components/book-call-link";
import { RupertAvatar } from "@/components/rupert-avatar";
import { formatDate } from "@/lib/format";
import {
  INTAKE_FILE_EXTENSIONS,
  INTAKE_LIMITS,
  extrasProgress,
  intakeFileProblem,
  intakeProgress,
  intakeReady,
  materialsProvided,
  topicCoverage,
  type IntakeConflict,
  type IntakeInterview,
  type IntakeTopic,
  type TopicCoverage,
} from "@/lib/intake";
import {
  MATERIALS_BUCKET,
  MATERIAL_MAX_BYTES,
  MATERIAL_MAX_FILES,
  NO_DECK_MAX,
  fileExtension,
  formatBytes,
  type MaterialsView,
} from "@/lib/setup";
import { createClient } from "@/lib/supabase/client";

const primaryButton =
  "inline-flex items-center justify-center gap-sm rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40";
const secondaryButton =
  "inline-flex items-center justify-center rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";

/** One-tap answers for the most common short replies. */
const QUICK_REPLIES = ["None", "Not sure yet", "Skip this one"];
const TEXTAREA_MAX_PX = 168;

const ACCEPT = INTAKE_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(",");

function FileBadge({ name }: { name: string }) {
  return (
    <span className="shrink-0 rounded border border-border px-xs text-label uppercase tracking-label text-muted">
      {fileExtension(name) || "file"}
    </span>
  );
}

function FileChip({ name }: { name: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-xs rounded-md border border-primary/30 bg-surface px-sm py-xs text-body-sm text-heading">
      <FileBadge name={name} />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** Where the founder's files and answers disagreed, and what they confirmed. */
function ConflictList({ conflicts }: { conflicts: IntakeConflict[] }) {
  if (conflicts.length === 0) return null;
  return (
    <div className="border-t border-border px-lg py-md">
      <p className="text-label uppercase tracking-label text-muted">
        Checked with you
      </p>
      <p className="mt-xs text-body-sm text-muted">
        Where your files and your answers differed. Rupert works from what you confirmed.
      </p>
      <ul className="mt-sm divide-y divide-border">
        {conflicts.map((conflict) => (
          <li key={conflict.id} className="py-sm text-body-sm">
            <p className="text-heading">
              {conflict.status === "resolved" ? conflict.resolution : "Not confirmed yet"}
            </p>
            <p className="mt-xs text-muted">
              {conflict.file || "Your files"}: {conflict.file_says} · You said: {conflict.founder_says}
            </p>
          </li>
        ))}
      </ul>
    </div>
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

/** One file being uploaded, before Rupert has it. */
type PendingUpload = { name: string; size: number; type: string; file: File };

type UploadedFile = { path: string; name: string; size: number; type: string };

export function IntakeExperience({
  initialInterview,
  initialMaterials,
  topics,
  completedAt,
  firstName,
  readOnly,
}: {
  initialInterview: IntakeInterview | null;
  initialMaterials: MaterialsView;
  topics: IntakeTopic[];
  completedAt: string | null;
  firstName: string;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [interview, setInterview] = useState<IntakeInterview | null>(
    initialInterview,
  );
  const [materials, setMaterials] = useState<MaterialsView>(initialMaterials);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<
    "start" | "send" | "upload" | "no_deck" | "summary" | "resume" | "confirm" | null
  >(null);
  // Shown in the conversation right away, before Rupert answers.
  const [outgoing, setOutgoing] = useState<{ text: string; files: string[] } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [panelDragging, setPanelDragging] = useState(false);
  // Files saved but not yet read by Rupert (his reply failed): sent again on retry.
  const [unread, setUnread] = useState<{ files: UploadedFile[]; note: string } | null>(null);
  const [noDeckOpen, setNoDeckOpen] = useState(false);
  const [noDeckReason, setNoDeckReason] = useState("");
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
  const materialsState = { fileCount: materials.files.length, noDeck: materials.noDeck };
  const hasMaterials = materialsProvided(materialsState);
  // The intake is complete for Rupert once the essentials are covered and
  // the materials are in (or the founder has no deck yet); the extras are
  // then recommended.
  const intakeDone =
    Boolean(completedAt) || intakeReady(topics, topicStatus, materialsState);
  const essentialsDone = progress.ready || Boolean(completedAt);
  const extras = extrasProgress(topics, topicStatus);
  const messages = interview?.messages ?? [];
  const conflicts = interview?.conflicts ?? [];
  const reviewing = interview?.status === "review" && !completed;
  const limitReached =
    (interview?.client_message_count ?? 0) >= INTAKE_LIMITS.clientMessagesMax;
  const roomForFiles = MATERIAL_MAX_FILES - materials.files.length;

  function apply(result: IntakeActionResult) {
    if (result.ok) {
      setInterview(result.interview);
      setMaterials(result.materials);
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

  /** Sends a message (or files) and shows it in the conversation at once. */
  async function deliver(
    kind: "send" | "upload" | "no_deck",
    shown: { text: string; files: string[] },
    action: () => Promise<IntakeActionResult>,
  ) {
    const wasDone = intakeDone;
    let nowDone = false;
    setOutgoing(shown);
    setDraft("");
    const sent = await run(kind, async () => {
      const result = await action();
      if (result.ok) {
        nowDone = intakeReady(topics, result.interview.topic_status, {
          fileCount: result.materials.files.length,
          noDeck: result.materials.noDeck,
        });
      }
      return result;
    });
    setOutgoing(null);
    if (!sent && kind === "send") setDraft(shown.text);
    // The intake just completed: refresh the sidebar and onboarding counts.
    if (sent && nowDone && !wasDone) router.refresh();
    inputRef.current?.focus();
    return sent;
  }

  async function onSend(event?: React.FormEvent, preset?: string) {
    event?.preventDefault();
    const text = (preset ?? draft).trim();
    if (!text || pending || readOnly || limitReached) return;
    await deliver("send", { text, files: [] }, () => sendIntakeMessage(text));
  }

  /** Uploads the files, then Rupert reads them all in one reply. */
  async function onFiles(list: FileList | File[] | null | undefined) {
    if (!list || pending || readOnly || limitReached) return;
    const incoming: PendingUpload[] = Array.from(list).map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
      file,
    }));
    if (incoming.length === 0) return;
    const problems = incoming
      .map((file) => intakeFileProblem(file))
      .filter((problem): problem is string => Boolean(problem));
    const valid = incoming.filter((file) => !intakeFileProblem(file)).slice(0, Math.max(roomForFiles, 0));
    if (valid.length < incoming.length - problems.length) {
      problems.push(`Up to ${MATERIAL_MAX_FILES} files can be shared.`);
    }
    if (valid.length === 0) {
      setError(problems.join(" ") || "Choose a file to share.");
      return;
    }

    const note = draft.trim();
    const sent = await deliver(
      "upload",
      { text: note, files: valid.map((file) => file.name) },
      async () => {
        const uploaded: UploadedFile[] = [];
        for (const item of valid) {
          const ticket = await createIntakeUpload({ name: item.name, size: item.size });
          if (!ticket.ok) return ticket;
          const { error: uploadError } = await createClient()
            .storage.from(MATERIALS_BUCKET)
            .uploadToSignedUrl(ticket.path, ticket.token, item.file, {
              contentType: item.type || undefined,
            });
          if (uploadError) {
            return { ok: false, error: `${item.name}: upload failed (${uploadError.message}).` };
          }
          uploaded.push({ path: ticket.path, name: item.name, size: item.size, type: item.type });
        }
        const result = await sendIntakeFiles({ files: uploaded, note });
        setUnread(!result.ok && result.aiUnavailable ? { files: uploaded, note } : null);
        return result;
      },
    );
    if (!sent && note) setDraft(note);
    if (sent && problems.length > 0) setError(problems.join(" "));
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onRetryFiles() {
    if (!unread || pending) return;
    const retry = unread;
    const sent = await deliver(
      "upload",
      { text: retry.note, files: retry.files.map((file) => file.name) },
      () => sendIntakeFiles(retry),
    );
    if (sent) setUnread(null);
  }

  async function onNoDeck(event: React.FormEvent) {
    event.preventDefault();
    const reason = noDeckReason.trim();
    if (!reason || pending || readOnly || limitReached) return;
    const sent = await deliver(
      "no_deck",
      { text: `I don't have a pitch deck yet. ${reason}`, files: [] },
      () => declareNoDeck(reason),
    );
    if (sent) {
      setNoDeckOpen(false);
      setNoDeckReason("");
    }
  }

  // Closed by Rupert's team before the founder started: nothing to continue.
  const closedWithoutChat = completed && messages.length === 0;
  // A confirmed intake stays open, so the founder can come back and add more.
  const chatOpen = !readOnly && !limitReached && !reviewing && !closedWithoutChat;
  const canWrite = chatOpen && pending === null;

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
  const uploading = pending === "upload";

  const materialsPanel = (
    <section
      aria-labelledby="intake-materials-title"
      className="rounded-card border border-border bg-surface"
    >
      <div className="flex items-start gap-sm border-b border-border px-lg py-md">
        <CoverageIcon coverage={hasMaterials || completed ? "covered" : "missing"} />
        <div className="min-w-0 flex-1">
          <h2 id="intake-materials-title" className="text-h4">
            Company materials
          </h2>
          <p className="mt-xs text-body-sm text-muted">
            {materials.files.length > 0
              ? `${materials.files.length} of ${MATERIAL_MAX_FILES} files shared`
              : materials.noDeck
                ? "No deck yet. That's fine."
                : "Start with your pitch deck. Add a one-pager, financials or anything else useful."}
          </p>
        </div>
      </div>

      {chatOpen ? (
        <div className="px-lg pt-md">
          <div
            role="button"
            tabIndex={canWrite ? 0 : -1}
            aria-disabled={!canWrite}
            aria-label="Share files: drop them here or press Enter to browse"
            onClick={() => canWrite && fileRef.current?.click()}
            onKeyDown={(event) => {
              if (!canWrite) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileRef.current?.click();
              }
            }}
            onDragOver={(event) => {
              if (!canWrite || !event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              setPanelDragging(true);
            }}
            onDragLeave={() => setPanelDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setPanelDragging(false);
              if (canWrite) void onFiles(event.dataTransfer.files);
            }}
            className={`flex flex-col items-center justify-center rounded-card border-2 border-dashed px-md py-lg text-center transition-colors duration-hover ${
              canWrite ? "cursor-pointer" : "cursor-not-allowed opacity-60"
            } ${
              panelDragging
                ? "border-primary bg-primary-tint"
                : "border-border bg-background hover:border-primary/50"
            }`}
          >
            <svg className="h-7 w-7 text-primary" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"
              />
            </svg>
            <p className="mt-sm text-body-sm text-heading">
              {uploading ? "Rupert is reading…" : (
                <>
                  Drop files here, or <span className="text-primary">browse</span>
                </>
              )}
            </p>
            <p className="mt-xs text-body-sm text-muted">
              PDF works best. PowerPoint, Word, Excel, CSV and images too, up to{" "}
              {formatBytes(MATERIAL_MAX_BYTES)} each.
            </p>
          </div>
        </div>
      ) : null}

      <ul className="divide-y divide-border px-lg py-sm">
        {materials.files.map((file) => (
          <li key={file.path} className="flex items-center gap-sm py-sm">
            <FileBadge name={file.name} />
            <span className="min-w-0 flex-1 truncate text-body-sm text-heading">{file.name}</span>
            <span className="shrink-0 text-body-sm text-muted">{formatBytes(file.size)}</span>
          </li>
        ))}
        {materials.files.length === 0 && materials.noDeck ? (
          <li className="py-sm text-body-sm text-muted">
            You told Rupert: {materials.noDeck}
          </li>
        ) : null}
        {materials.files.length === 0 && !materials.noDeck ? (
          <li className="py-sm text-body-sm text-muted">No files shared yet.</li>
        ) : null}
      </ul>

      {chatOpen && materials.files.length === 0 && !materials.noDeck ? (
        <div className="border-t border-border px-lg py-md">
          {noDeckOpen ? (
            <form onSubmit={onNoDeck}>
              <label
                htmlFor="intake-no-deck"
                className="block text-body-sm text-heading"
              >
                No deck yet? Tell Rupert briefly why.
              </label>
              <textarea
                id="intake-no-deck"
                rows={2}
                value={noDeckReason}
                maxLength={NO_DECK_MAX}
                onChange={(event) => setNoDeckReason(event.target.value)}
                placeholder="e.g. We're still building it, it'll be ready next month."
                className="mt-sm w-full resize-y rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary"
              />
              <div className="mt-sm flex flex-wrap gap-sm">
                <button
                  type="submit"
                  className={primaryButton}
                  disabled={!canWrite || !noDeckReason.trim()}
                >
                  {pending === "no_deck" ? "Sending…" : "Tell Rupert"}
                </button>
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={pending !== null}
                  onClick={() => setNoDeckOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="text-body-sm text-primary hover:text-primary-hover disabled:opacity-40"
              disabled={!canWrite}
              onClick={() => setNoDeckOpen(true)}
            >
              I don&apos;t have a deck yet
            </button>
          )}
        </div>
      ) : null}

      {materials.submitted ? (
        <div className="border-t border-border px-lg py-md">
          <Link
            href="/portal/materials"
            className="text-body-sm text-primary no-underline hover:text-primary-hover"
          >
            {readOnly ? "View company files" : "Add or view company files"}
          </Link>
        </div>
      ) : null}
    </section>
  );

  const progressPanel = (
    <aside className="rounded-card border border-border bg-surface">
      <div className="flex items-center gap-md border-b border-border px-lg py-lg">
        <ProgressRing percent={essentialsDone ? 100 : progress.percent} />
        <div>
          <p className="text-h4 text-heading">
            {completed
              ? "Intake complete"
              : intakeDone
                ? "You're done"
                : essentialsDone
                  ? "Almost there"
                  : "Your intake"}
          </p>
          <p className="mt-xs text-body-sm text-muted">
            {completed
              ? materials.submitted
                ? "Thank you. Rupert is on it."
                : "Last step: share your deck and materials."
              : intakeDone
                ? extras.total > 0
                  ? `Extras: ${extras.covered} of ${extras.total} covered`
                  : "Rupert has what he needs."
                : essentialsDone
                  ? "Share your deck, or tell Rupert you don't have one yet."
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
            className={`${intakeDone ? primaryButton : secondaryButton} w-full`}
            disabled={!intakeDone || pending !== null || readOnly}
            onClick={() => void run("summary", requestIntakeSummary)}
          >
            {pending === "summary" ? "Writing your summary…" : "Review Summary"}
          </button>
          <p className="mt-sm text-center text-body-sm text-muted">
            {intakeDone
              ? "Check what Rupert gathered and confirm it. The extras are optional."
              : "Opens once the essentials and your materials are in."}
          </p>
        </div>
      ) : null}
    </aside>
  );

  const sidebar = (
    <div className="flex flex-col gap-lg lg:sticky lg:top-lg lg:self-start">
      {materialsPanel}
      {progressPanel}
    </div>
  );

  const errorBlock = error ? (
    <div role="alert" className="mt-sm text-body-sm text-error">
      {error}
      {unread && !pending ? (
        <>
          {" "}
          <button
            type="button"
            className="text-primary hover:text-primary-hover"
            onClick={() => void onRetryFiles()}
          >
            Try again
          </button>
        </>
      ) : aiUnavailable ? (
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

  if (closedWithoutChat) {
    return (
      <div className="grid gap-lg lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-card border border-border bg-surface">
          <div className="flex items-center gap-md p-lg">
            <RupertAvatar size={56} />
            <div>
              <h2 className="text-h4">
                Thank you{firstName ? `, ${firstName}` : ""}.
              </h2>
              <p className="mt-xs text-body-sm text-muted">
                Intake confirmed
                {completedAt ? ` on ${formatDate(completedAt)}` : ""}.
                {materials.submitted
                  ? " Rupert is on it."
                  : " One step left in onboarding."}
              </p>
            </div>
          </div>
          {materials.submitted ? null : (
            <div className="mx-lg mb-lg flex flex-wrap items-center justify-between gap-md rounded-card border border-primary/30 bg-primary-tint px-lg py-md">
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
            <dl className="divide-y divide-border border-t border-border px-lg">
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
          <ConflictList conflicts={conflicts} />
        </section>
        {sidebar}
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
          <ConflictList conflicts={conflicts} />
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
        {sidebar}
      </div>
    );
  }

  const summaryDetails = interview?.summary ? (
    <details className="mt-md rounded-card border border-border bg-surface">
      <summary className="cursor-pointer px-md py-sm text-body-sm text-primary hover:text-primary-hover">
        View Your Summary
      </summary>
      <dl className="divide-y divide-border border-t border-border px-md">
        {interview.summary.map((item) => (
          <div key={item.topic_id} className="py-sm">
            <dt className="text-label uppercase tracking-label text-muted">{item.title}</dt>
            <dd className="mt-xs whitespace-pre-wrap text-body-sm text-body">{item.answer}</dd>
          </div>
        ))}
      </dl>
    </details>
  ) : null;

  const comeBackLine =
    "You can come back any time to add a comment here or share new materials. Rupert's team sees everything you add.";

  const essentialsBanner = completed ? (
    <section
      role="status"
      className="mb-lg rounded-card border border-primary/30 bg-primary-tint px-lg py-md"
    >
      <div className="flex flex-wrap items-start gap-md">
        <CoverageIcon coverage="covered" />
        <div className="min-w-0 flex-1">
          <p className="text-body-sm text-heading">
            <span className="font-medium">
              Your intake is complete{firstName ? `, ${firstName}` : ""}. Thank you.
            </span>{" "}
            Confirmed{completedAt ? ` on ${formatDate(completedAt)}` : ""}. {comeBackLine}
          </p>
          {materials.submitted ? null : (
            <Link
              href="/portal/materials"
              className={`${primaryButton} mt-sm no-underline`}
            >
              Share Materials
            </Link>
          )}
        </div>
      </div>
      {summaryDetails}
      <ConflictList conflicts={conflicts} />
    </section>
  ) : essentialsDone ? (
    <section
      role="status"
      className="mb-lg flex flex-wrap items-start gap-md rounded-card border border-primary/30 bg-primary-tint px-lg py-md"
    >
      <CoverageIcon coverage={intakeDone ? "covered" : "partial"} />
      <div className="min-w-0 flex-1">
        <p className="text-body-sm text-heading">
          {!intakeDone ? (
            <>
              <span className="font-medium">The essentials are done.</span>{" "}
              One thing left: share your deck in the materials panel, or tell
              Rupert you don&apos;t have one yet.
            </>
          ) : (
            <>
              <span className="font-medium">You&apos;re done. Your intake is 100% complete.</span>{" "}
              Rupert has everything he needs. Review your summary and confirm it.
              {extras.done
                ? ""
                : " The extras are optional: a few more minutes on them can make your campaign sharper."}{" "}
              {comeBackLine}
            </>
          )}
        </p>
        {intakeDone ? (
          <div className="mt-sm flex flex-wrap items-center gap-md">
            <button
              type="button"
              className={primaryButton}
              disabled={readOnly || pending !== null}
              onClick={() => void run("summary", requestIntakeSummary)}
            >
              {pending === "summary" ? "Writing your summary…" : "Review Summary"}
            </button>
            {!extras.done ? (
              <button
                type="button"
                className="text-body-sm text-primary hover:text-primary-hover disabled:opacity-40"
                disabled={readOnly || limitReached}
                onClick={() => inputRef.current?.focus()}
              >
                Add the extras
              </button>
            ) : null}
          </div>
        ) : null}
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
            void onFiles(event.dataTransfer.files);
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
                  {(message.attachments ?? []).map((file) => (
                    <FileChip key={file.path} name={file.name} />
                  ))}
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
                {outgoing.files.map((name) => (
                  <FileChip key={name} name={name} />
                ))}
                {outgoing.text ? (
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-card rounded-br-none bg-primary-tint px-md py-sm text-body-sm leading-relaxed text-heading">
                    {outgoing.text}
                  </p>
                ) : null}
              </div>
            ) : null}
            {pending === "start" || pending === "send" || pending === "no_deck" ? (
              <TypingIndicator />
            ) : null}
            {uploading ? (
              <TypingIndicator label="Reading your files. This can take up to a minute." />
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
                multiple
                accept={ACCEPT}
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => void onFiles(event.target.files)}
              />
              <button
                type="button"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-hover hover:bg-surface hover:text-heading disabled:opacity-40"
                aria-label="Share files (your deck and other materials)"
                title="Share files (your deck and other materials)"
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
              <span>Enter to send · Shift+Enter for a new line · Drop files to share them</span>
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
              <p className="text-body-sm text-heading">Drop your files to share them with Rupert</p>
            </div>
          ) : null}
        </section>
        {sidebar}
      </div>
    </>
  );
}
