"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  addLinkedinFileAction,
  buildBriefAction,
  createLinkedinUploadAction,
  removeLinkedinFileAction,
  resetBriefAction,
  skipLinkedinAction,
  restoreBriefVersionAction,
  saveBriefSectionsAction,
  saveSellingPointsAction,
  scoreSellingPointsAction,
  saveDeckAction,
  saveFounderQuestionsAction,
  saveNarrativeAction,
  scoreDeckAction,
  writeDeckFeedbackAction,
  writeNarrativeFromBriefAction,
} from "@/app/admin/brief-actions";
import { inputClass, primaryButton, secondaryButton } from "@/app/admin/clients/[id]/setup/shared";
import { MarkdownField } from "@/app/admin/clients/[id]/setup/markdown-field";
import { createSetupUpload } from "@/app/admin/agent-actions";

/** Text written as "- " lines shows as a bullet list; anything else as a paragraph. */
function Bullets({ text, className = "" }: { text: string; className?: string }) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const bulleted = lines.length > 0 && lines.every((line) => /^([-*•]|\d+[.)])\s+/.test(line));
  if (!bulleted) return <p className={`whitespace-pre-wrap ${className}`}>{text}</p>;
  return (
    <ul className={`list-disc space-y-xs pl-lg ${className}`}>
      {lines.map((line, index) => (
        <li key={index}>{line.replace(/^([-*•]|\d+[.)])\s+/, "")}</li>
      ))}
    </ul>
  );
}

const smallButton =
  "rounded-md border border-border bg-surface px-sm py-px text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40";
import { AutoTextarea } from "@/components/email-body-field";
import { DropSummary as Summary } from "@/components/drop-summary";
import { MarkdownBody } from "@/components/markdown-body";
import {
  ABSTRACT_HINT,
  QUESTIONS_HINT,
  SELLING_POINTS_CHOSEN,
  abstractBullets,
  abstractCard,
  type SellingPoint,
  DECK_TOPICS,
  DECK_TOPICS_PER_CLIENT,
  briefQuestions,
  deckTopic,
  type BriefTopic,
  type CompanyBrief,
  type FounderQuestion,
  type DeckFile,
  type DeckLink,
  titleCase,
} from "@/lib/brief";
import type { BriefFiles, BriefNarrative, BriefVersionRow } from "@/lib/brief-server";
import { createClient } from "@/lib/supabase/client";
import { MATERIALS_BUCKET } from "@/lib/setup";
import { formatDateAtTime } from "@/lib/format";

type Notice = { kind: "ok" | "error"; text: string } | null;
type ActionResult = { ok: true; brief: CompanyBrief } | { ok: false; error: string };

const card = "rounded-card border border-border bg-surface";
const label = "text-label uppercase tracking-label text-muted";

export function FramingRoom({
  clientId,
  initialBrief,
  initialVersions,
  founderQuestions,
  topics,
  initialLinkedin,
  linkedinError,
  linkedinUrls,
  sellingPoints,
  narrative,
  canBuild,
  buildNote,
  claudeReady,
}: {
  clientId: string;
  initialBrief: CompanyBrief | null;
  initialVersions: BriefVersionRow[];
  founderQuestions: FounderQuestion[];
  topics: BriefTopic[];
  initialLinkedin: BriefFiles;
  linkedinError: string | null;
  /** LinkedIn profile links the founder gave, to open and save as PDF. */
  linkedinUrls: string[];
  sellingPoints: SellingPoint[];
  narrative: BriefNarrative;
  canBuild: boolean;
  buildNote: string | null;
  claudeReady: boolean;
}) {
  const [brief, setBrief] = useState<CompanyBrief | null>(initialBrief);
  const [versions, setVersions] = useState<BriefVersionRow[]>(initialVersions);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [linkedin, setLinkedin] = useState<BriefFiles>(initialLinkedin);
  const linkedinReady = linkedin.linkedin.length > 0 || linkedin.skipped;

  function adopt(next: CompanyBrief) {
    setBrief(next);
    setVersions((current) => [
      { version: next.version, note: next.note, createdBy: next.createdBy, createdAt: next.createdAt },
      ...current.filter((row) => row.version !== next.version),
    ]);
  }

  async function run(key: string, work: () => Promise<ActionResult>, ok?: string) {
    setBusy(key);
    setNotice(null);
    try {
      const result = await work();
      if (!result.ok) {
        setNotice({ kind: "error", text: result.error });
        return false;
      }
      adopt(result.brief);
      if (ok) setNotice({ kind: "ok", text: ok });
      return true;
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "Something went wrong." });
      return false;
    } finally {
      setBusy(null);
    }
  }

  // The first time the room opens after the intake, Rupert builds the brief on his own.

  const building = busy === "build";

  return (
    <div className="grid gap-lg">
      <div className="grid min-w-0 content-start gap-lg">
        <section className={`${card} px-lg py-md`}>
          <div className="flex flex-wrap items-center justify-between gap-sm">
            <div>
              <h2 className="text-h4">Company Brief</h2>
              <p className="mt-xs text-body-sm text-muted">
                {brief
                  ? `Version ${brief.version} · ${formatDateAtTime(brief.createdAt)}${brief.note ? ` · ${brief.note}` : ""}`
                  : building
                    ? "Rupert is reading everything and researching the founder and company. This takes 1–4 minutes; keep this page open."
                    : canBuild && !linkedinReady
                      ? "Upload the founder's LinkedIn PDFs below (or skip), then click Build Brief."
                      : canBuild
                      ? "Not built yet."
                      : (buildNote ?? "Not available yet.")}
              </p>
              {!brief && buildNote && canBuild ? <p className="mt-xs text-body-sm text-warning">{buildNote}</p> : null}
            </div>
            <div className="flex flex-wrap gap-sm">
            <a
              href={`/admin/clients/${clientId}/brief-pack`}
              className={`${secondaryButton} no-underline`}
              title="Everything an AI needs, with instructions, as one Markdown file. Attach the deck and LinkedIn PDFs alongside it."
            >
              Download for AI
            </a>
            {brief || linkedin.linkedin.length > 0 || linkedin.skipped ? (
              <button
                type="button"
                className={secondaryButton}
                disabled={busy !== null}
                onClick={() => {
                  if (
                    !window.confirm(
                      "Start over? This deletes the brief and its history, the selling points, the deck feedback, the questions, and a narrative draft that was never sent. The intake, company materials (including the LinkedIn PDFs) and links stay.",
                    )
                  )
                    return;
                  setBusy("reset");
                  void resetBriefAction(clientId)
                    .then((result) => {
                      if (!result.ok) setNotice({ kind: "error", text: result.error });
                      else window.location.reload();
                    })
                    .finally(() => setBusy(null));
                }}
              >
                {busy === "reset" ? "Clearing…" : "Start Over"}
              </button>
            ) : null}
            <button
              type="button"
              className={brief ? secondaryButton : primaryButton}
              disabled={busy !== null || !canBuild || !claudeReady || (!brief && !linkedinReady)}
              title={!brief && !linkedinReady ? "Upload the founder's LinkedIn PDF, or click Skip, first." : undefined}
              onClick={() => {
                if (brief && !window.confirm("Rebuild the brief from scratch? The current version stays in the history.")) return;
                void run("build", () => buildBriefAction(clientId), "Brief rebuilt.");
              }}
            >
              {building ? "Building…" : brief ? "Rebuild Brief" : "Build Brief"}
            </button>
            </div>
          </div>
          {!claudeReady ? <p className="mt-sm text-body-sm text-warning">Claude is not configured (ANTHROPIC_API_KEY).</p> : null}
          {notice ? (
            <p role={notice.kind === "error" ? "alert" : "status"} className={`mt-sm text-body-sm ${notice.kind === "ok" ? "text-success" : "text-error"}`}>
              {notice.text}
            </p>
          ) : null}
          {versions.length > 1 ? (
            <details className="group/drop mt-sm text-body-sm">
              <Summary>History ({versions.length} Versions)</Summary>
              <ul className="mt-sm grid gap-xs">
                {versions.map((row) => (
                  <li key={row.version} className="flex flex-wrap items-baseline gap-sm">
                    <span className="text-heading">v{row.version}</span>
                    <span className="text-muted">{formatDateAtTime(row.createdAt)}</span>
                    <span className="text-secondary">{row.note}</span>
                    {brief && row.version !== brief.version ? (
                      <button
                        type="button"
                        className="text-primary disabled:opacity-40"
                        disabled={busy !== null}
                        onClick={() => {
                          if (!window.confirm(`Put version ${row.version} back? It becomes a new version; nothing is lost.`)) return;
                          void run(`restore-${row.version}`, () => restoreBriefVersionAction(clientId, row.version), `Version ${row.version} restored.`);
                        }}
                      >
                        Restore
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>

        <LinkedinCard
          clientId={clientId}
          files={linkedin}
          error={linkedinError}
          urls={linkedinUrls}
          hasBrief={Boolean(brief)}
          disabled={busy !== null}
          onChange={setLinkedin}
        />

        {brief ? (
          <>
            <AbstractCard
              value={brief.sections.abstract ?? ""}
              disabled={busy !== null}
              onSave={(value) => run("abstract", () => saveBriefSectionsAction(clientId, { ...brief.sections, abstract: value }, "Edited the abstract."), "Abstract saved.")}
            />
            <details className="group/drop">
              <Summary>Full Brief: {topics.filter((topic) => topic.enabled).length} Topics and the Questions</Summary>
              <div className="mt-md grid gap-md">
            <div className="grid gap-md xl:grid-cols-2">
              {topics
                .filter((topic) => topic.enabled)
                .map((topic) => (
                  <SectionCard
                    key={topic.id}
                    sectionKey={topic.id}
                    title={topic.title}
                    hint={topic.guidance}
                    value={brief.sections[topic.id] ?? ""}
                    disabled={busy !== null}
                    onSave={(value) =>
                      run(topic.id, () => saveBriefSectionsAction(clientId, { ...brief.sections, [topic.id]: value }, `Edited ${topic.title}.`), `${topic.title} saved.`)
                    }
                  />
                ))}
            </div>
            <SectionCard
              sectionKey="questions"
              title="Questions for the Founder"
              hint={QUESTIONS_HINT}
              value={brief.sections.questions ?? ""}
              disabled={busy !== null}
              onSave={(value) => run("questions", () => saveBriefSectionsAction(clientId, { ...brief.sections, questions: value }, "Edited the questions."), "Questions saved.")}
            />
              </div>
            </details>
            <PointsPanel clientId={clientId} brief={brief} list={sellingPoints} busy={busy} run={run} claudeReady={claudeReady} />
            <NarrativeStage
              clientId={clientId}
              narrative={narrative}
              pointsConfirmed={Boolean(brief.points.confirmed_at)}
              claudeReady={claudeReady}
              busy={busy}
              setBusy={setBusy}
            />
            <FeedbackStage
              clientId={clientId}
              brief={brief}
              narrativeFinalized={Boolean(narrative.finalized_at)}
              busy={busy}
              run={run}
              claudeReady={claudeReady}
            />
            <SendStage clientId={clientId} brief={brief} narrative={narrative} founderQuestions={founderQuestions} busy={busy} setBusy={setBusy} />
          </>
        ) : null}
      </div>


    </div>
  );
}

function SectionCard({
  sectionKey,
  title,
  hint,
  value,
  disabled,
  onSave,
}: {
  sectionKey: string;
  title: string;
  hint: string;
  value: string;
  disabled: boolean;
  onSave: (value: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);

  return (
    <section id={`brief-${sectionKey}`} className={`${card} px-lg py-md`}>
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="min-w-0">
          <h3 className="text-h4">{titleCase(title)}</h3>
          <p className="mt-xs text-body-sm text-muted" title={hint}>
            {hint.length > 90 ? `${hint.slice(0, 88)}…` : hint}
          </p>
        </div>
        {editing ? (
          <div className="flex gap-sm">
            <button type="button" className={secondaryButton} onClick={() => { setText(value); setEditing(false); }}>
              Cancel
            </button>
            <button
              type="button"
              className={primaryButton}
              disabled={disabled || text === value}
              onClick={() => void onSave(text).then((saved) => saved && setEditing(false))}
            >
              Save
            </button>
          </div>
        ) : (
          <button type="button" className={secondaryButton} disabled={disabled} onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>
      <div className="mt-md">
        {editing ? (
          <AutoTextarea className={`${inputClass} font-mono`} value={text} aria-label={title} onChange={(event) => setText(event.target.value)} />
        ) : (
          <MarkdownBody content={value} emptyLabel="Empty." className="sow-markdown text-body-sm" />
        )}
      </div>
    </section>
  );
}

/** A stage's title row: its number, title and where it stands. */
function StageHead({
  n,
  title,
  status,
  tone,
  children,
}: {
  n: number;
  title: string;
  status: string;
  tone: "done" | "open" | "locked";
  children?: ReactNode;
}) {
  const chip =
    tone === "done"
      ? "bg-success/10 text-success border-success/30"
      : tone === "open"
        ? "bg-primary-tint text-primary border-primary/30"
        : "bg-background text-muted border-border";
  return (
    <div className="flex flex-wrap items-start justify-between gap-sm">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-sm">
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-body-sm text-heading">{n}</span>
          <h3 className="text-h4">{title}</h3>
          <span className={`rounded-full border px-sm py-px text-body-sm ${chip}`}>{status}</span>
        </div>
      </div>
      {children ? <div className="flex flex-wrap gap-sm">{children}</div> : null}
    </div>
  );
}

const NARRATIVE_FIELDS = [
  { key: "summary", title: "The Outreach Narrative", hint: "What the client reads and confirms. 150 to 250 words.", height: 280 },
  { key: "core", title: "Core Story", hint: "For Rupert and the emails.", height: 300 },
  { key: "key_messages", title: "Key Messages", hint: "3 to 6 messages carried into outreach.", height: 220 },
  { key: "approach", title: "Approach", hint: "Positioning by investor type, tone, what leads and what is held back.", height: 220 },
] as const;
type NarrativeText = Pick<BriefNarrative, "summary" | "core" | "key_messages" | "approach">;

/** Stage 2: the Outreach Narrative, written from the confirmed points, edited and finalized. Not sent yet. */
function NarrativeStage({
  clientId,
  narrative,
  pointsConfirmed,
  claudeReady,
  busy,
  setBusy,
}: {
  clientId: string;
  narrative: BriefNarrative;
  pointsConfirmed: boolean;
  claudeReady: boolean;
  busy: string | null;
  setBusy: (value: string | null) => void;
}) {
  const router = useRouter();
  const pick = (value: BriefNarrative): NarrativeText => ({
    summary: value.summary,
    core: value.core,
    key_messages: value.key_messages,
    approach: value.approach,
  });
  const [text, setText] = useState<NarrativeText>(pick(narrative));
  const [notice, setNotice] = useState<Notice>(null);
  useEffect(() => setText(pick(narrative)), [narrative]);
  const finalized = Boolean(narrative.finalized_at);
  const hasText = Boolean(narrative.summary.trim() || narrative.core.trim());
  const changed = JSON.stringify(text) !== JSON.stringify(pick(narrative));
  const changesRequested = narrative.status === "changes_requested";

  async function act(key: string, work: () => Promise<{ ok: true } | { ok: false; error: string }>, ok: string) {
    setBusy(key);
    setNotice(null);
    try {
      const result = await work();
      if (!result.ok) setNotice({ kind: "error", text: result.error });
      else {
        setNotice({ kind: "ok", text: ok });
        router.refresh();
      }
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setBusy(null);
    }
  }

  function write() {
    if (hasText && !window.confirm(changesRequested ? "Rewrite the narrative with the client's requested changes? It replaces the current text." : "Rewrite the narrative from the brief? It replaces the current text.")) return;
    void act("narrative-write", () => writeNarrativeFromBriefAction(clientId), "Narrative written. Edit it, then Finalize.");
  }

  return (
    <section className={`${card} px-lg py-md`}>
      <StageHead
        n={2}
        title="Outreach Narrative"
        status={finalized ? "Finalized" : hasText ? "Draft" : pointsConfirmed ? "Ready to write" : "After the selling points"}
        tone={finalized ? "done" : pointsConfirmed ? "open" : "locked"}
      >
        {!finalized ? (
          <button
            type="button"
            className={hasText && !changesRequested ? secondaryButton : primaryButton}
            disabled={busy !== null || !pointsConfirmed || !claudeReady}
            title={pointsConfirmed ? undefined : "Confirm & Finalize the selling points first."}
            onClick={write}
          >
            {busy === "narrative-write" ? "Writing…" : changesRequested ? "Rewrite With Client's Changes" : hasText ? "Rewrite" : "Write Outreach Narrative"}
          </button>
        ) : null}
      </StageHead>
      <p className="mt-xs max-w-prose text-body-sm text-muted">
        Written from the brief, leading with the 3 confirmed selling points in order. Edit it and Finalize. Nothing goes to the client until stage 4.
      </p>
      {busy === "narrative-write" ? <p className="mt-sm text-body-sm text-muted">Writing from the brief. Usually under a minute.</p> : null}
      {changesRequested && narrative.change_summary ? (
        <div className="mt-md rounded-md border border-primary/30 bg-primary-tint px-md py-sm">
          <p className={label}>What Changed · only you see this</p>
          <MarkdownBody content={narrative.change_summary} emptyLabel="" className="sow-markdown mt-xs text-body-sm" />
        </div>
      ) : null}

      {hasText ? (
        finalized ? (
          <div className="mt-md grid gap-md">
            <div className="rounded-md border border-border bg-background px-md py-sm">
              <p className={label}>The Outreach Narrative · what the client confirms</p>
              <MarkdownBody content={narrative.summary} emptyLabel="" className="sow-markdown mt-xs text-body-sm" />
            </div>
            <details className="group/drop text-body-sm">
              <Summary>Core Story, Key Messages and Approach</Summary>
              <div className="mt-sm grid gap-md">
                {NARRATIVE_FIELDS.slice(1).map((field) => (
                  <div key={field.key}>
                    <p className={label}>{field.title}</p>
                    <MarkdownBody content={narrative[field.key]} emptyLabel="" className="sow-markdown mt-xs text-body-sm" />
                  </div>
                ))}
              </div>
            </details>
            <div className="flex flex-wrap items-center justify-between gap-sm rounded-md border border-success/30 bg-success/10 px-md py-sm">
              <p className="text-body-sm text-heading">Finalized {formatDateAtTime(narrative.finalized_at ?? "")}. This is what the client will review.</p>
              <button
                type="button"
                className={secondaryButton}
                disabled={busy !== null}
                onClick={() => void act("narrative-save", () => saveNarrativeAction(clientId, text, false), "Unlocked. Edit, then Finalize again.")}
              >
                Unlock to Edit
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-md grid gap-lg">
            {NARRATIVE_FIELDS.map((field) => (
              <div key={field.key}>
                <p className={label}>{field.title}</p>
                <p className="mb-sm mt-xs text-body-sm text-muted">{field.hint}</p>
                <MarkdownField
                  label={field.title}
                  value={text[field.key]}
                  height={field.height}
                  onChange={(value) => setText((current) => ({ ...current, [field.key]: value }))}
                />
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-sm">
              <button
                type="button"
                className={primaryButton}
                disabled={busy !== null}
                onClick={() => void act("narrative-final", () => saveNarrativeAction(clientId, text, true), "Narrative finalized. Next: the Company Materials Feedback.")}
              >
                {busy === "narrative-final" ? "Finalizing…" : "Finalize Narrative"}
              </button>
              {changed ? (
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={busy !== null}
                  onClick={() => void act("narrative-save", () => saveNarrativeAction(clientId, text, false), "Draft saved.")}
                >
                  {busy === "narrative-save" ? "Saving…" : "Save Draft"}
                </button>
              ) : null}
              <span className="text-body-sm text-muted">Not finalized yet</span>
            </div>
          </div>
        )
      ) : null}
      {notice ? (
        <p role={notice.kind === "error" ? "alert" : "status"} className={`mt-sm text-body-sm ${notice.kind === "ok" ? "text-success" : "text-error"}`}>
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}

/** One point of feedback's links and documents. */
function PointAttachments({
  clientId,
  links,
  files,
  disabled,
  onLinks,
  onFiles,
}: {
  clientId: string;
  links: DeckLink[];
  files: DeckFile[];
  disabled: boolean;
  onLinks: (links: DeckLink[]) => void;
  onFiles: (files: DeckFile[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(list: FileList | null) {
    const file = list?.[0];
    if (input.current) input.current.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const ticket = await createSetupUpload(clientId, { name: file.name, size: file.size });
      if (!ticket.ok) throw new Error(ticket.error);
      const { error: uploadError } = await createClient()
        .storage.from(MATERIALS_BUCKET)
        .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type || undefined });
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
      onFiles([...files, { path: ticket.path, name: file.name.slice(0, 255), size: file.size, type: file.type.slice(0, 120), uploaded_at: new Date().toISOString() }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function addLink() {
    const url = linkUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      setError("Links start with http:// or https://");
      return;
    }
    onLinks([...links, { id: `l${Date.now().toString(36)}`, label: linkLabel.trim(), url }]);
    setLinkLabel("");
    setLinkUrl("");
    setAdding(false);
    setError(null);
  }

  return (
    <div className="text-body-sm">
      {links.length > 0 || files.length > 0 ? (
        <ul className="mb-xs grid gap-xs">
          {links.map((link) => (
            <li key={link.id} className="flex items-center gap-sm">
              <span className="text-muted">Link</span>
              <a href={link.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-primary">
                {link.label || link.url}
              </a>
              <button type="button" className="text-muted hover:text-error disabled:opacity-40" disabled={disabled} onClick={() => onLinks(links.filter((item) => item.id !== link.id))} aria-label={`Remove ${link.label || link.url}`}>
                ×
              </button>
            </li>
          ))}
          {files.map((file) => (
            <li key={file.path} className="flex items-center gap-sm">
              <span className="text-muted">Document</span>
              <span className="min-w-0 truncate text-heading">{file.name}</span>
              <button type="button" className="text-muted hover:text-error disabled:opacity-40" disabled={disabled} onClick={() => onFiles(files.filter((item) => item.path !== file.path))} aria-label={`Remove ${file.name}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {adding ? (
        <div className="flex flex-wrap items-center gap-xs">
          <input className={`${inputClass} mt-0 w-40 bg-surface`} placeholder="Label" value={linkLabel} onChange={(event) => setLinkLabel(event.target.value)} />
          <input className={`${inputClass} mt-0 min-w-0 flex-1 bg-surface`} placeholder="https://" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} />
          <button type="button" className={smallButton} onClick={addLink}>
            Add
          </button>
          <button type="button" className={smallButton} onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-xs">
          <button type="button" className={smallButton} disabled={disabled} onClick={() => setAdding(true)}>
            + Add Link
          </button>
          <button type="button" className={smallButton} disabled={disabled || uploading} onClick={() => input.current?.click()}>
            {uploading ? "Uploading…" : "+ Add Document"}
          </button>
          <input ref={input} type="file" className="hidden" onChange={(event) => void upload(event.target.files)} />
        </div>
      )}
      {error ? <p className="mt-xs text-error">{error}</p> : null}
    </div>
  );
}

/** Stage 3: the Company Materials Feedback: all topics scored, the top 3 written, re-ranked, edited and confirmed. */
function FeedbackStage({
  clientId,
  brief,
  narrativeFinalized,
  busy,
  run,
  claudeReady,
}: {
  clientId: string;
  brief: CompanyBrief;
  narrativeFinalized: boolean;
  busy: string | null;
  run: (key: string, work: () => Promise<ActionResult>, ok?: string) => Promise<boolean>;
  claudeReady: boolean;
}) {
  const deck = brief.deck;
  const [chosen, setChosen] = useState<string[]>(deck.chosen);
  const [writeups, setWriteups] = useState<Record<string, string>>(deck.writeups);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [links, setLinks] = useState<Record<string, DeckLink[]>>(deck.links);
  const [files, setFiles] = useState<Record<string, DeckFile[]>>(deck.files);
  useEffect(() => {
    setChosen(deck.chosen);
    setWriteups(deck.writeups);
    setScores({});
    setLinks(deck.links);
    setFiles(deck.files);
  }, [deck]);

  const confirmed = Boolean(deck.confirmed_at);
  const locked = confirmed || busy !== null;
  const aiScore = (id: string) => deck.scores.find((item) => item.topic === id);
  const scoreValue = (id: string): number | undefined => scores[id] ?? aiScore(id)?.score;
  const ordered = [...DECK_TOPICS].sort((a, b) => (scoreValue(b.id) ?? -1) - (scoreValue(a.id) ?? -1));
  const changed =
    chosen.join() !== deck.chosen.join() ||
    Object.entries(scores).some(([id, value]) => value !== aiScore(id)?.score) ||
    JSON.stringify(writeups) !== JSON.stringify(deck.writeups) ||
    JSON.stringify(links) !== JSON.stringify(deck.links) ||
    JSON.stringify(files) !== JSON.stringify(deck.files);
  const missing = chosen.filter((id) => !(writeups[id] ?? "").trim());
  const change = (confirm: boolean) => ({ chosen, writeups, scores, links, files, confirm });

  function toggle(id: string) {
    setChosen((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : current.length >= DECK_TOPICS_PER_CLIENT ? current : [...current, id],
    );
  }

  function move(index: number, to: number) {
    setChosen((current) => {
      if (to < 0 || to >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  async function score() {
    const scored = await run("score", () => scoreDeckAction(clientId), "Scored. Writing the top 3…");
    if (scored) await run("write", () => writeDeckFeedbackAction(clientId), "Feedback scored and the top 3 written. Edit, re-rank, then Confirm & Finalize.");
  }

  async function writeMissing() {
    const saved = await run("deck-save", () => saveDeckAction(clientId, change(false)));
    if (saved) await run("write", () => writeDeckFeedbackAction(clientId, true), "Written. Edit it, then Confirm & Finalize.");
  }

  return (
    <section className={`${card} px-lg py-md`}>
      <StageHead
        n={3}
        title="Company Materials Feedback"
        status={confirmed ? "Confirmed" : deck.scores.length > 0 ? "Draft" : narrativeFinalized ? "Ready to score" : "After the narrative"}
        tone={confirmed ? "done" : narrativeFinalized ? "open" : "locked"}
      >
        <button
          type="button"
          className={deck.scores.length > 0 ? secondaryButton : primaryButton}
          disabled={busy !== null || !claudeReady || confirmed || !narrativeFinalized}
          title={!narrativeFinalized ? "Finalize the narrative first." : confirmed ? "Unlock to edit first." : undefined}
          onClick={() => void score()}
        >
          {busy === "score" ? "Scoring…" : busy === "write" ? "Writing…" : deck.scores.length > 0 ? "Score Again" : "Score Feedback"}
        </button>
      </StageHead>
      <p className="mt-xs max-w-prose text-body-sm text-muted">
        Rupert scores all {DECK_TOPICS.length} topics by how much fixing each would help this raise, and writes the top {DECK_TOPICS_PER_CLIENT}. Edit the text, change scores, re-rank, and add a link or document to any point. The client reads these; there is nothing for them to confirm.
      </p>

      {deck.scores.length > 0 ? (
        <>
          <ol className="mt-md flex flex-col gap-sm">
            {chosen.map((id, index) => (
              <li key={id} className="flex flex-col gap-xs rounded-md border border-primary/30 bg-primary-tint px-md py-sm">
                <div className="flex flex-wrap items-center justify-between gap-sm">
                  <p className="text-label uppercase tracking-label text-primary">
                    #{index + 1} · Score {scoreValue(id) ?? "–"}
                  </p>
                  <div className={`flex gap-xs ${confirmed ? "hidden" : ""}`}>
                    {index > 0 ? (
                      <button type="button" className={smallButton} disabled={busy !== null} onClick={() => move(index, 0)}>
                        Make #1
                      </button>
                    ) : null}
                    <button type="button" className={smallButton} disabled={busy !== null || index === 0} aria-label="Move up" onClick={() => move(index, index - 1)}>
                      ↑
                    </button>
                    <button type="button" className={smallButton} disabled={busy !== null || index === chosen.length - 1} aria-label="Move down" onClick={() => move(index, index + 1)}>
                      ↓
                    </button>
                  </div>
                </div>
                <p className="text-body text-heading">{titleCase(deckTopic(id)?.title ?? id)}</p>
                {confirmed ? (
                  <MarkdownBody content={writeups[id] ?? ""} emptyLabel="" className="sow-markdown text-body-sm" />
                ) : (writeups[id] ?? "").trim() || deck.writeups[id] !== undefined ? (
                  <AutoTextarea
                    className={`${inputClass} bg-surface`}
                    value={writeups[id] ?? ""}
                    aria-label={`Feedback: ${deckTopic(id)?.title ?? id}`}
                    disabled={busy !== null}
                    onChange={(event) => setWriteups((current) => ({ ...current, [id]: event.target.value }))}
                  />
                ) : (
                  <p className="text-body-sm text-muted">Not written yet. Use Write Missing below.</p>
                )}
                <PointAttachments
                  clientId={clientId}
                  links={links[id] ?? []}
                  files={files[id] ?? []}
                  disabled={locked}
                  onLinks={(next) => setLinks((current) => ({ ...current, [id]: next }))}
                  onFiles={(next) => setFiles((current) => ({ ...current, [id]: next }))}
                />
              </li>
            ))}
          </ol>
          <details className={`group/drop mt-md text-body-sm ${confirmed ? "hidden" : ""}`} open={chosen.length < DECK_TOPICS_PER_CLIENT}>
            <Summary>All {DECK_TOPICS.length} Topics, by Score</Summary>
            <p className="mt-xs text-muted">Disagree with a score? Change it. Tick up to {DECK_TOPICS_PER_CLIENT} to give back.</p>
            <ul className="mt-sm grid gap-xs">
              {ordered.map((topic) => {
                const ai = aiScore(topic.id);
                const value = scoreValue(topic.id);
                const overridden = scores[topic.id] !== undefined && scores[topic.id] !== ai?.score;
                const on = chosen.includes(topic.id);
                return (
                  <li key={topic.id} className="flex items-start gap-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={on}
                      disabled={locked || (!on && chosen.length >= DECK_TOPICS_PER_CLIENT)}
                      onChange={() => toggle(topic.id)}
                      aria-label={topic.title}
                    />
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={value ?? ""}
                      disabled={locked || !ai}
                      aria-label={`Score for ${topic.title}`}
                      onChange={(event) => {
                        const number = Math.max(0, Math.min(10, Math.round(Number(event.target.value))));
                        if (event.target.value !== "" && Number.isFinite(number)) setScores((current) => ({ ...current, [topic.id]: number }));
                      }}
                      className={`w-12 shrink-0 rounded-md border bg-background px-xs py-px text-right ${overridden ? "border-primary" : "border-border"} ${
                        value !== undefined && value >= 7 ? "text-error" : value !== undefined && value >= 4 ? "text-warning" : "text-muted"
                      }`}
                    />
                    <span>
                      <span className="text-heading">{titleCase(topic.title)}</span>
                      {overridden ? <span className="text-primary"> · AI said {ai?.score}</span> : null}
                      {ai?.reason ? <span className="text-muted"> · {ai.reason}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
          {confirmed ? (
            <div className="mt-md flex flex-wrap items-center justify-between gap-sm rounded-md border border-success/30 bg-success/10 px-md py-sm">
              <p className="text-body-sm text-heading">Confirmed {formatDateAtTime(deck.confirmed_at ?? "")}. It goes to the client with the narrative.</p>
              <button type="button" className={secondaryButton} disabled={busy !== null} onClick={() => void run("deck-save", () => saveDeckAction(clientId, change(false)), "Unlocked. Edit, then Confirm & Finalize again.")}>
                Unlock to Edit
              </button>
            </div>
          ) : (
            <div className="mt-md flex flex-wrap items-center gap-sm">
              <button
                type="button"
                className={primaryButton}
                disabled={busy !== null || chosen.length === 0 || missing.length > 0}
                title={missing.length > 0 ? "Write the missing points first." : undefined}
                onClick={() => void run("deck-confirm", () => saveDeckAction(clientId, change(true)), "Feedback confirmed. Next: send to the client.")}
              >
                {busy === "deck-confirm" ? "Confirming…" : "Confirm & Finalize"}
              </button>
              {missing.length > 0 ? (
                <button type="button" className={secondaryButton} disabled={busy !== null || !claudeReady} onClick={() => void writeMissing()}>
                  {busy === "write" ? "Writing…" : `Write Missing (${missing.length})`}
                </button>
              ) : null}
              {changed ? (
                <button type="button" className={secondaryButton} disabled={busy !== null} onClick={() => void run("deck-save", () => saveDeckAction(clientId, change(false)), "Draft saved.")}>
                  {busy === "deck-save" ? "Saving…" : "Save Draft"}
                </button>
              ) : null}
              <span className="text-body-sm text-muted">
                {chosen.length} of {DECK_TOPICS_PER_CLIENT} chosen · not confirmed yet
              </span>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

/** Stage 4: choose the questions, then draft the email and push it all to the client's portal. */
function SendStage({
  clientId,
  brief,
  narrative,
  founderQuestions,
  busy,
  setBusy,
}: {
  clientId: string;
  brief: CompanyBrief;
  narrative: BriefNarrative;
  founderQuestions: FounderQuestion[];
  busy: string | null;
  setBusy: (value: string | null) => void;
}) {
  const router = useRouter();
  const questions = briefQuestions(brief.sections.questions ?? "");
  const [ask, setAsk] = useState<string[]>(narrative.asked);
  const [notice, setNotice] = useState<Notice>(null);
  useEffect(() => setAsk(narrative.asked), [narrative.asked]);
  const answered = founderQuestions.filter((item) => item.answer);
  const ready = Boolean(narrative.finalized_at) && Boolean(brief.deck.confirmed_at);
  const askChanged = ask.join("\n") !== narrative.asked.join("\n");
  const sent = narrative.version > 0;

  async function saveQuestions() {
    setBusy("questions-save");
    setNotice(null);
    try {
      const result = await saveFounderQuestionsAction(clientId, ask);
      if (!result.ok) setNotice({ kind: "error", text: result.error });
      else {
        setNotice({ kind: "ok", text: "Questions saved. They go with the narrative." });
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  const checks = [
    { label: "3 strongest selling points confirmed", done: Boolean(brief.points.confirmed_at) },
    { label: "Outreach Narrative finalized", done: Boolean(narrative.finalized_at) },
    { label: "Company Materials Feedback confirmed", done: Boolean(brief.deck.confirmed_at) },
  ];

  return (
    <section className={`${card} px-lg py-md`}>
      <StageHead
        n={4}
        title="Send to Client"
        status={
          narrative.status === "confirmed"
            ? "Client confirmed"
            : narrative.status === "changes_requested"
              ? "Client asked for changes"
              : sent
                ? "Sent"
                : ready
                  ? "Ready to send"
                  : "After stages 1 to 3"
        }
        tone={narrative.status === "confirmed" ? "done" : ready ? "open" : "locked"}
      />
      <p className="mt-xs max-w-prose text-body-sm text-muted">
        The client gets the Outreach Narrative to confirm or comment on, the materials feedback to read, and the questions you tick. Draft the email and push it in the Outreach Narrative step below.
      </p>
      <ul className="mt-md grid gap-xs text-body-sm">
        {checks.map((check) => (
          <li key={check.label} className={check.done ? "text-success" : "text-muted"}>
            {check.done ? "✓" : "○"} {check.label}
          </li>
        ))}
      </ul>

      <div className="mt-md">
        <p className={label}>Questions for the Founder</p>
        {questions.length === 0 ? (
          <p className="mt-xs text-body-sm text-muted">No questions in the brief.</p>
        ) : (
          <ul className="mt-xs grid gap-xs text-body-sm">
            {questions.map((question) => (
              <li key={question} className="flex items-start gap-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={ask.includes(question)}
                  disabled={busy !== null}
                  onChange={() => setAsk((current) => (current.includes(question) ? current.filter((item) => item !== question) : [...current, question]))}
                  aria-label={question}
                />
                <span>{question}</span>
              </li>
            ))}
          </ul>
        )}
        {askChanged ? (
          <button type="button" className={`${secondaryButton} mt-sm`} disabled={busy !== null} onClick={() => void saveQuestions()}>
            {busy === "questions-save" ? "Saving…" : `Save Questions (${ask.length})`}
          </button>
        ) : null}
      </div>

      {answered.length > 0 ? (
        <div className="mt-md">
          <p className={label}>The Founder Answered</p>
          <ul className="mt-xs grid gap-sm text-body-sm">
            {answered.map((item) => (
              <li key={item.id}>
                <p className="text-heading">{item.question}</p>
                <p className="whitespace-pre-wrap text-secondary">{item.answer}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-md flex flex-wrap items-center gap-sm">
        {ready ? (
          <Link href={`/admin/clients/${clientId}#setup-framing`} className={`${primaryButton} no-underline`}>
            {sent ? "Open the Send Step" : "Draft Email & Push"}
          </Link>
        ) : (
          <span className={`${primaryButton} cursor-not-allowed opacity-40`} aria-disabled>
            Draft Email & Push
          </span>
        )}
      </div>
      {notice ? (
        <p role={notice.kind === "error" ? "alert" : "status"} className={`mt-sm text-body-sm ${notice.kind === "ok" ? "text-success" : "text-error"}`}>
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}

/** The abstract: one card per bullet, so it reads at a glance. */
function AbstractCard({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (value: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);
  const bullets = abstractBullets(value);

  return (
    <section id="brief-abstract" className={`${card} px-lg py-md`}>
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div>
          <h3 className="text-h4">Abstract</h3>
          <p className="mt-xs text-body-sm text-muted">{ABSTRACT_HINT}</p>
        </div>
        {editing ? (
          <div className="flex gap-sm">
            <button type="button" className={secondaryButton} onClick={() => { setText(value); setEditing(false); }}>
              Cancel
            </button>
            <button type="button" className={primaryButton} disabled={disabled || text === value} onClick={() => void onSave(text).then((saved) => saved && setEditing(false))}>
              Save
            </button>
          </div>
        ) : (
          <button type="button" className={secondaryButton} disabled={disabled} onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <AutoTextarea className={`${inputClass} mt-md`} value={text} aria-label="Abstract" onChange={(event) => setText(event.target.value)} />
      ) : bullets.length > 0 ? (
        <ul className="mt-md grid gap-sm">
          {bullets.map((bullet, index) => {
            const item = abstractCard(bullet);
            return (
              <li key={index} className="rounded-md border border-border bg-background px-md py-sm">
                {item.title ? <p className="text-label uppercase tracking-label text-primary">{titleCase(item.title)}</p> : null}
                <MarkdownBody content={item.text} emptyLabel="" className="sow-markdown mt-xs text-body-sm text-heading" />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-md text-body-sm text-muted">Empty. Rebuild the brief to write it.</p>
      )}
    </section>
  );
}

/** The ten selling points: all scored, the top three chosen (swappable), with what to say. */
function PointsPanel({
  clientId,
  brief,
  list,
  busy,
  run,
  claudeReady,
}: {
  clientId: string;
  brief: CompanyBrief;
  list: SellingPoint[];
  busy: string | null;
  run: (key: string, work: () => Promise<ActionResult>, ok?: string) => Promise<boolean>;
  claudeReady: boolean;
}) {
  const points = brief.points;
  // The current list, plus any point a saved score still names.
  const shown: SellingPoint[] = [
    ...list,
    ...points.scores.filter((item) => !list.some((point) => point.id === item.point)).map((item) => ({ id: item.point, title: item.title || item.point, guidance: "" })),
  ];
  const [chosen, setChosen] = useState<string[]>(points.chosen);
  const [pitches, setPitches] = useState<Record<string, string>>({});
  // Scores Rupert overrides, by point id.
  const [scores, setScores] = useState<Record<string, number>>({});
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [watchOuts, setWatchOuts] = useState<Record<string, string>>({});
  useEffect(() => {
    setChosen(points.chosen);
    setPitches(Object.fromEntries(points.scores.map((item) => [item.point, item.pitch])));
    setTitles(Object.fromEntries(points.scores.map((item) => [item.point, item.title])));
    setWatchOuts(Object.fromEntries(points.scores.map((item) => [item.point, item.watch_out])));
    setScores({});
  }, [points]);
  const confirmed = Boolean(points.confirmed_at);
  const locked = confirmed || busy !== null;

  const aiScore = (id: string) => points.scores.find((item) => item.point === id);
  const scoreValue = (id: string): number | undefined => scores[id] ?? aiScore(id)?.score;
  const ordered = [...shown].sort((a, b) => (scoreValue(b.id) ?? -1) - (scoreValue(a.id) ?? -1));
  const scoresChanged = Object.entries(scores).some(([id, value]) => value !== aiScore(id)?.score);
  const changed =
    chosen.join() !== points.chosen.join() ||
    scoresChanged ||
    points.scores.some((item) => (pitches[item.point] ?? item.pitch) !== item.pitch || (titles[item.point] ?? item.title) !== item.title || (watchOuts[item.point] ?? item.watch_out) !== item.watch_out);
  const save = (confirm: boolean, ok: string) =>
    run(confirm ? "points-confirm" : "points-save", () => saveSellingPointsAction(clientId, chosen, pitches, scores, titles, confirm, watchOuts), ok);

  function move(index: number, to: number) {
    setChosen((current) => {
      if (to < 0 || to >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  function setScore(id: string, raw: string) {
    const number = Math.max(0, Math.min(10, Math.round(Number(raw))));
    if (raw === "" || !Number.isFinite(number)) return;
    setScores((current) => ({ ...current, [id]: number }));
  }

  function toggle(id: string) {
    setChosen((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : current.length >= SELLING_POINTS_CHOSEN ? current : [...current, id],
    );
  }

  return (
    <section className={`${card} px-lg py-md`}>
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div>
          <div className="flex flex-wrap items-center gap-sm">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-body-sm text-heading">1</span>
            <h3 className="text-h4">The 3 Strongest Selling Points</h3>
            <span
              className={`rounded-full border px-sm py-px text-body-sm ${
                confirmed ? "border-success/30 bg-success/10 text-success" : "border-primary/30 bg-primary-tint text-primary"
              }`}
            >
              {confirmed ? "Confirmed" : points.scores.length > 0 ? "Draft" : "Ready to score"}
            </span>
          </div>
          <p className="mt-xs max-w-prose text-body-sm text-muted">
            Rupert scores all {list.length} for this raise and picks the top {SELLING_POINTS_CHOSEN}. Change any score, swap points, set the order (#1 leads) and edit what to say. The narrative leads with these.
          </p>
        </div>
        <div className="flex flex-wrap gap-sm">
        <Link href="/admin/forms/selling-points" className={`${secondaryButton} no-underline`}>
          Edit the List
        </Link>
        <button
          type="button"
          className={points.scores.length > 0 ? secondaryButton : primaryButton}
          disabled={busy !== null || !claudeReady || confirmed}
          title={confirmed ? "Unlock to edit first." : undefined}
          onClick={() => void run("points", () => scoreSellingPointsAction(clientId), "Selling points scored. The top three are chosen.")}
        >
          {busy === "points" ? "Scoring…" : points.scores.length > 0 ? "Score Again" : "Score Selling Points"}
        </button>
        </div>
      </div>

      {points.scores.length > 0 ? (
        <>
          <ol className="mt-md flex flex-col gap-sm">
            {chosen.map((id, index) => {
              const point = shown.find((item) => item.id === id);
              return point ? (
                <li key={id} className="flex flex-col gap-xs rounded-md border border-primary/30 bg-primary-tint px-md py-sm">
                  <div className="flex flex-wrap items-center justify-between gap-sm">
                    <p className="text-label uppercase tracking-label text-primary">
                      #{index + 1} · Score {scoreValue(id) ?? "–"}
                    </p>
                    <div className={`flex gap-xs ${confirmed ? "hidden" : ""}`}>
                      {index > 0 ? (
                        <button type="button" className={smallButton} disabled={busy !== null} onClick={() => move(index, 0)}>
                          Make #1
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={smallButton}
                        disabled={busy !== null || index === 0}
                        aria-label={`Move ${point.title} up`}
                        onClick={() => move(index, index - 1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className={smallButton}
                        disabled={busy !== null || index === chosen.length - 1}
                        aria-label={`Move ${point.title} down`}
                        onClick={() => move(index, index + 1)}
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                  {confirmed ? (
                    <>
                      <p className="text-body text-heading">{titleCase(titles[id] || point.title)}</p>
                      <Bullets text={pitches[id] ?? ""} className="text-body-sm text-body" />
                      {watchOuts[id] ? (
                        <div className="mt-xs rounded-md border border-warning/30 bg-surface px-sm py-xs text-body-sm text-secondary">
                          <span className="text-label uppercase tracking-label text-warning">Watch Out · Internal</span>
                          <Bullets text={watchOuts[id]} className="mt-xs" />
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <label className="text-body-sm text-muted">
                        Headline
                        <input
                          className={`${inputClass} bg-surface text-heading`}
                          value={titles[id] ?? point.title}
                          maxLength={100}
                          disabled={busy !== null}
                          onChange={(event) => setTitles((current) => ({ ...current, [id]: event.target.value }))}
                        />
                      </label>
                      <label className="text-body-sm text-muted">
                        What to Say
                        <AutoTextarea
                          className={`${inputClass} bg-surface`}
                          value={pitches[id] ?? ""}
                          placeholder="How this point is said to investors."
                          disabled={busy !== null}
                          onChange={(event) => setPitches((current) => ({ ...current, [id]: event.target.value }))}
                        />
                      </label>
                      <label className="text-body-sm text-warning">
                        Watch Out: How an Investor Could Push Back (Internal, Never Said)
                        <AutoTextarea
                          className={`${inputClass} border-warning/30 bg-surface text-secondary`}
                          value={watchOuts[id] ?? ""}
                          placeholder="What is unverified, how it could be attacked, what not to say."
                          disabled={busy !== null}
                          onChange={(event) => setWatchOuts((current) => ({ ...current, [id]: event.target.value }))}
                        />
                      </label>
                    </>
                  )}
                </li>
              ) : null;
            })}
          </ol>
          <details className={`group/drop mt-md text-body-sm ${confirmed ? "hidden" : ""}`} open={chosen.length < SELLING_POINTS_CHOSEN}>
            <Summary>All {shown.length} Points, by Score</Summary>
            <p className="mt-xs text-muted">Disagree with a score? Change it. Tick up to {SELLING_POINTS_CHOSEN} to use.</p>
            <ul className="mt-sm grid gap-xs">
              {ordered.map((point) => {
                const score = aiScore(point.id);
                const value = scoreValue(point.id);
                const overridden = scores[point.id] !== undefined && scores[point.id] !== score?.score;
                const on = chosen.includes(point.id);
                return (
                  <li key={point.id} className="flex items-start gap-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={on}
                      disabled={locked || (!on && chosen.length >= SELLING_POINTS_CHOSEN)}
                      onChange={() => toggle(point.id)}
                      aria-label={point.title}
                    />
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={value ?? ""}
                      disabled={locked || !score}
                      aria-label={`Score for ${point.title}`}
                      title={overridden ? `Rupert's score. AI said ${score?.score}.` : "Score out of 10"}
                      onChange={(event) => setScore(point.id, event.target.value)}
                      className={`w-12 shrink-0 rounded-md border bg-background px-xs py-px text-right ${overridden ? "border-primary" : "border-border"} ${
                        value !== undefined && value >= 7 ? "text-success" : value !== undefined && value >= 4 ? "text-warning" : "text-muted"
                      }`}
                    />
                    <span>
                      <span className="text-heading">{titleCase(point.title)}</span>
                      {overridden ? <span className="text-primary"> · AI said {score?.score}</span> : null}
                      {score?.reason ? <span className="text-muted"> · {score.reason}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
          {confirmed ? (
            <div className="mt-md flex flex-wrap items-center justify-between gap-sm rounded-md border border-success/30 bg-success/10 px-md py-sm">
              <p className="text-body-sm text-heading">
                Confirmed {points.confirmed_at ? formatDateAtTime(points.confirmed_at) : ""}. These lead the narrative, the copy and everything after.
              </p>
              <button
                type="button"
                className={secondaryButton}
                disabled={busy !== null}
                onClick={() => void save(false, "Unlocked. Edit, then Confirm & Finalize again.")}
              >
                Unlock to Edit
              </button>
            </div>
          ) : (
            <div className="mt-md flex flex-wrap items-center gap-sm">
              <button
                type="button"
                className={primaryButton}
                disabled={busy !== null || chosen.length < SELLING_POINTS_CHOSEN}
                title={chosen.length < SELLING_POINTS_CHOSEN ? `Choose ${SELLING_POINTS_CHOSEN} points first.` : undefined}
                onClick={() => void save(true, "Selling points confirmed. The narrative and everything after lead with them.")}
              >
                {busy === "points-confirm" ? "Confirming…" : "Confirm & Finalize"}
              </button>
              {changed ? (
                <button type="button" className={secondaryButton} disabled={busy !== null} onClick={() => void save(false, "Draft saved.")}>
                  {busy === "points-save" ? "Saving…" : "Save Draft"}
                </button>
              ) : null}
              <span className="text-body-sm text-muted">
                {chosen.length} of {SELLING_POINTS_CHOSEN} chosen · not confirmed yet
              </span>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

/** The founder's LinkedIn, as a PDF Dori uploads: AI can't open LinkedIn. The first brief waits for it. */
function LinkedinCard({
  clientId,
  files,
  error,
  urls,
  hasBrief,
  disabled,
  onChange,
}: {
  clientId: string;
  files: BriefFiles;
  error: string | null;
  urls: string[];
  hasBrief: boolean;
  disabled: boolean;
  onChange: (files: BriefFiles) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(error);
  const done = files.linkedin.length > 0;

  async function upload(list: FileList | null) {
    const picked = Array.from(list ?? []);
    if (input.current) input.current.value = "";
    if (picked.length === 0) return;
    setBusy(true);
    setNotice(null);
    let latest: BriefFiles | null = null;
    try {
      for (const file of picked.slice(0, 6)) {
        const ticket = await createLinkedinUploadAction(clientId, { name: file.name, size: file.size });
        if (!ticket.ok) throw new Error(ticket.error);
        const { error: uploadError } = await createClient()
          .storage.from(MATERIALS_BUCKET)
          .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: "application/pdf" });
        if (uploadError) throw new Error(`${file.name}: upload failed (${uploadError.message}).`);
        const saved = await addLinkedinFileAction(clientId, { path: ticket.path, name: file.name, size: file.size, type: file.type || "application/pdf" });
        if (!saved.ok) throw new Error(saved.error);
        latest = saved.files;
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      // Build brief turns on only once every file picked is in.
      if (latest) onChange(latest);
      setBusy(false);
    }
  }

  async function act(work: () => Promise<{ ok: true; files: BriefFiles } | { ok: false; error: string }>) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await work();
      if (!result.ok) setNotice(result.error);
      else onChange(result.files);
    } finally {
      setBusy(false);
    }
  }

  if (hasBrief && (done || files.skipped)) {
    return (
      <p className="text-body-sm text-muted">
        Founder&apos;s LinkedIn: {done ? files.linkedin.map((file) => file.name).join(", ") : "skipped"} ·{" "}
        <button type="button" className="text-primary disabled:opacity-40" disabled={disabled || busy} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : "Add a PDF"}
        </button>
        {done ? " (then Rebuild Brief)" : ""}
        <input ref={input} type="file" accept=".pdf" multiple className="hidden" onChange={(event) => void upload(event.target.files)} />
        {notice ? <span className="block text-error">{notice}</span> : null}
      </p>
    );
  }

  return (
    <section className={`${card} border-primary/30 px-lg py-md`}>
      <h3 className="text-h4">Founder&apos;s LinkedIn</h3>
      <p className="mt-xs max-w-prose text-body-sm text-muted">
        AI can&apos;t open LinkedIn. Open each founder&apos;s profile, choose More → Save to PDF, and upload them here (you can pick several at once). When they&apos;re all in, click Build brief.
      </p>
      {urls.length > 0 ? (
        <p className="mt-sm text-body-sm">
          From the intake:{" "}
          {urls.map((url, index) => (
            <span key={url}>
              {index > 0 ? " · " : ""}
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                {url.replace(/^https?:\/\/(www\.)?/, "")}
              </a>
            </span>
          ))}
        </p>
      ) : (
        <p className="mt-sm text-body-sm text-muted">No LinkedIn link in the intake.</p>
      )}
      {done ? (
        <ul className="mt-sm grid gap-xs text-body-sm">
          {files.linkedin.map((file) => (
            <li key={file.path} className="flex items-center gap-sm">
              <span className="text-heading">{file.name}</span>
              <button
                type="button"
                className="text-primary disabled:opacity-40"
                disabled={disabled || busy}
                onClick={() => void act(() => removeLinkedinFileAction(clientId, file.path))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-sm flex flex-wrap items-center gap-sm">
        <button type="button" className={primaryButton} disabled={disabled || busy} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : done ? "Add More PDFs" : "Upload LinkedIn PDFs"}
        </button>
        {!done && !files.skipped ? (
          <button type="button" className={secondaryButton} disabled={disabled || busy} onClick={() => void act(() => skipLinkedinAction(clientId))}>
            Skip, Build Without It
          </button>
        ) : null}
        <input ref={input} type="file" accept=".pdf" multiple className="hidden" onChange={(event) => void upload(event.target.files)} />
      </div>
      {notice ? <p role="alert" className="mt-sm text-body-sm text-error">{notice}</p> : null}
    </section>
  );
}
