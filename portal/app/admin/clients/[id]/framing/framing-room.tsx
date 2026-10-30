"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  addLinkedinFileAction,
  buildBriefAction,
  createLinkedinUploadAction,
  removeLinkedinFileAction,
  resetBriefAction,
  skipLinkedinAction,
  chooseDeckTopicsAction,
  restoreBriefVersionAction,
  saveBriefSectionsAction,
  saveSellingPointsAction,
  scoreSellingPointsAction,
  saveDeckWriteupsAction,
  scoreDeckAction,
  writeDeckFeedbackAction,
  writeNarrativeFromBriefAction,
} from "@/app/admin/brief-actions";
import { inputClass, primaryButton, secondaryButton } from "@/app/admin/clients/[id]/setup/shared";
import { AutoTextarea } from "@/components/email-body-field";
import { MarkdownBody } from "@/components/markdown-body";
import {
  ABSTRACT_HINT,
  QUESTIONS_HINT,
  SELLING_POINTS,
  SELLING_POINTS_CHOSEN,
  abstractBullets,
  DECK_TOPICS,
  DECK_TOPICS_PER_CLIENT,
  briefQuestions,
  deckTopic,
  type BriefTopic,
  type CompanyBrief,
  type FounderQuestion,
} from "@/lib/brief";
import type { BriefFiles, BriefVersionRow } from "@/lib/brief-server";
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
  canBuild: boolean;
  buildNote: string | null;
  claudeReady: boolean;
}) {
  const [brief, setBrief] = useState<CompanyBrief | null>(initialBrief);
  const [versions, setVersions] = useState<BriefVersionRow[]>(initialVersions);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const autoStarted = useRef(false);
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
  // It waits for the founder's LinkedIn PDF (or for Dori to skip it).
  useEffect(() => {
    if (autoStarted.current || brief || !canBuild || !claudeReady || !linkedinReady) return;
    autoStarted.current = true;
    void run("build", () => buildBriefAction(clientId), "Brief built. Read the abstract, then score the selling points.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedinReady]);

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
                      ? "Waiting for the founder's LinkedIn PDF (below), or skip it."
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
                      "Start over? This deletes the brief and its history, the chat, the selling points, the deck feedback, the questions, and a narrative draft that was never sent. The intake, materials and links stay.",
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
                {busy === "reset" ? "Clearing…" : "Start over"}
              </button>
            ) : null}
            <button
              type="button"
              className={brief ? secondaryButton : primaryButton}
              disabled={busy !== null || !canBuild || !claudeReady}
              onClick={() => {
                if (brief && !window.confirm("Rebuild the brief from scratch? The current version stays in the history; the chat is kept.")) return;
                void run("build", () => buildBriefAction(clientId), "Brief rebuilt.");
              }}
            >
              {building ? "Building…" : brief ? "Rebuild brief" : "Build brief"}
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
            <details className="mt-sm text-body-sm">
              <summary className="cursor-pointer text-primary">History ({versions.length} versions)</summary>
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
            <PointsPanel clientId={clientId} brief={brief} busy={busy} run={run} claudeReady={claudeReady} />
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
              title="Questions for the founder"
              hint={QUESTIONS_HINT}
              value={brief.sections.questions ?? ""}
              disabled={busy !== null}
              onSave={(value) => run("questions", () => saveBriefSectionsAction(clientId, { ...brief.sections, questions: value }, "Edited the questions."), "Questions saved.")}
            />
          </>
        ) : null}

        {brief ? (
          <>
            <DeckPanel clientId={clientId} brief={brief} busy={busy} run={run} claudeReady={claudeReady} />
            <OutputsPanel clientId={clientId} brief={brief} founderQuestions={founderQuestions} busy={busy} setBusy={setBusy} claudeReady={claudeReady} />
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
          <h3 className="text-h4">{title}</h3>
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

function DeckPanel({
  clientId,
  brief,
  busy,
  run,
  claudeReady,
}: {
  clientId: string;
  brief: CompanyBrief;
  busy: string | null;
  run: (key: string, work: () => Promise<ActionResult>, ok?: string) => Promise<boolean>;
  claudeReady: boolean;
}) {
  const deck = brief.deck;
  const [chosen, setChosen] = useState<string[]>(deck.chosen);
  const [writeups, setWriteups] = useState<Record<string, string>>(deck.writeups);
  useEffect(() => setChosen(deck.chosen), [deck.chosen]);
  useEffect(() => setWriteups(deck.writeups), [deck.writeups]);

  const scoreOf = (id: string) => deck.scores.find((item) => item.topic === id);
  const ordered = [...DECK_TOPICS].sort((a, b) => (scoreOf(b.id)?.score ?? -1) - (scoreOf(a.id)?.score ?? -1));
  const choiceChanged = chosen.join() !== deck.chosen.join();
  const writeupsChanged = JSON.stringify(writeups) !== JSON.stringify(deck.writeups);

  function toggle(id: string) {
    setChosen((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : current.length >= DECK_TOPICS_PER_CLIENT ? current : [...current, id],
    );
  }

  return (
    <section className={`${card} px-lg py-md`}>
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div>
          <h3 className="text-h4">Deck feedback for the founder</h3>
          <p className="mt-xs max-w-prose text-body-sm text-muted">
            Rupert scores the deck on {DECK_TOPICS.length} topics and picks the {DECK_TOPICS_PER_CLIENT} that matter most. Swap any of them, then write them. The founder gets these three with the narrative.
          </p>
        </div>
        <button
          type="button"
          className={deck.scores.length > 0 ? secondaryButton : primaryButton}
          disabled={busy !== null || !claudeReady}
          onClick={() => void run("score", () => scoreDeckAction(clientId), "Deck scored. The top three are chosen; swap any, then write them.")}
        >
          {busy === "score" ? "Scoring…" : deck.scores.length > 0 ? "Score again" : "Score deck"}
        </button>
      </div>

      {deck.scores.length > 0 ? (
        <>
          <ul className="mt-md grid gap-xs text-body-sm">
            {ordered.map((topic) => {
              const score = scoreOf(topic.id);
              const on = chosen.includes(topic.id);
              return (
                <li key={topic.id} className="flex items-start gap-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={on}
                    disabled={!on && chosen.length >= DECK_TOPICS_PER_CLIENT}
                    onChange={() => toggle(topic.id)}
                    aria-label={topic.title}
                  />
                  <span className={`w-6 shrink-0 text-right ${score && score.score >= 7 ? "text-error" : score && score.score >= 4 ? "text-warning" : "text-muted"}`}>
                    {score?.score ?? "–"}
                  </span>
                  <span>
                    <span className="text-heading">{topic.title}</span>
                    {score?.reason ? <span className="text-muted"> · {score.reason}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-md flex flex-wrap gap-sm">
            {choiceChanged ? (
              <button
                type="button"
                className={secondaryButton}
                disabled={busy !== null || chosen.length === 0}
                onClick={() => void run("choose", () => chooseDeckTopicsAction(clientId, chosen), "Topics saved.")}
              >
                Save choice ({chosen.length} of {DECK_TOPICS_PER_CLIENT})
              </button>
            ) : null}
            <button
              type="button"
              className={Object.keys(deck.writeups).length > 0 ? secondaryButton : primaryButton}
              disabled={busy !== null || choiceChanged || deck.chosen.length === 0 || !claudeReady}
              title={choiceChanged ? "Save the choice first." : undefined}
              onClick={() => void run("write", () => writeDeckFeedbackAction(clientId), "Feedback written. Edit it if you like.")}
            >
              {busy === "write" ? "Writing…" : Object.keys(deck.writeups).length > 0 ? "Rewrite feedback" : "Write feedback"}
            </button>
          </div>
        </>
      ) : null}

      {deck.chosen.some((id) => deck.writeups[id]) ? (
        <div className="mt-lg grid gap-md">
          {deck.chosen.map((id, index) =>
            deck.writeups[id] !== undefined ? (
              <div key={id}>
                <p className={label}>
                  {index + 1}. {deckTopic(id)?.title}
                </p>
                <AutoTextarea
                  className={`${inputClass} mt-xs`}
                  value={writeups[id] ?? ""}
                  aria-label={deckTopic(id)?.title ?? id}
                  onChange={(event) => setWriteups((current) => ({ ...current, [id]: event.target.value }))}
                />
              </div>
            ) : null,
          )}
          {writeupsChanged ? (
            <button
              type="button"
              className={`${primaryButton} justify-self-start`}
              disabled={busy !== null}
              onClick={() => void run("writeups", () => saveDeckWriteupsAction(clientId, writeups), "Feedback saved.")}
            >
              Save feedback
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function OutputsPanel({
  clientId,
  brief,
  founderQuestions,
  busy,
  setBusy,
  claudeReady,
}: {
  clientId: string;
  brief: CompanyBrief;
  founderQuestions: FounderQuestion[];
  busy: string | null;
  setBusy: (value: string | null) => void;
  claudeReady: boolean;
}) {
  const questions = briefQuestions(brief.sections.questions);
  const [ask, setAsk] = useState<string[]>(questions);
  const [notice, setNotice] = useState<Notice>(null);
  const answered = founderQuestions.filter((item) => item.answer);
  useEffect(() => setAsk(briefQuestions(brief.sections.questions)), [brief.sections.questions]);

  async function write() {
    setBusy("narrative");
    setNotice(null);
    try {
      const result = await writeNarrativeFromBriefAction(clientId, ask);
      if (!result.ok) setNotice({ kind: "error", text: result.error });
      else setNotice({ kind: "ok", text: "Narrative written on the client page, with the deck feedback and questions. Review it there, then push it." });
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={`${card} px-lg py-md`}>
      <h3 className="text-h4">For the founder</h3>
      <p className="mt-xs max-w-prose text-body-sm text-muted">
        Rupert writes the Outreach Narrative from this brief and puts it on the client page with the deck feedback and the questions you tick. Nothing reaches the founder until you push it there.
      </p>

      <div className="mt-md">
        <p className={label}>Questions to ask</p>
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
                  onChange={() => setAsk((current) => (current.includes(question) ? current.filter((item) => item !== question) : [...current, question]))}
                  aria-label={question}
                />
                <span>{question}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {answered.length > 0 ? (
        <div className="mt-md">
          <p className={label}>The founder answered</p>
          <ul className="mt-xs grid gap-sm text-body-sm">
            {answered.map((item) => (
              <li key={item.id}>
                <p className="text-heading">{item.question}</p>
                <p className="whitespace-pre-wrap text-secondary">{item.answer}</p>
              </li>
            ))}
          </ul>
          <p className="mt-xs text-body-sm text-muted">Rupert reads these answers in the chat and when the brief is rebuilt.</p>
        </div>
      ) : null}

      <div className="mt-md flex flex-wrap items-center gap-sm">
        <button type="button" className={primaryButton} disabled={busy !== null || !claudeReady} onClick={() => void write()}>
          {busy === "narrative" ? "Writing…" : "Write narrative from brief"}
        </button>
        <Link href={`/admin/clients/${clientId}#setup-framing`} className="text-body-sm text-primary">
          Open the Outreach Narrative →
        </Link>
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
        <ul className="mt-md grid gap-sm sm:grid-cols-2">
          {bullets.map((bullet, index) => (
            <li key={index} className="rounded-md border border-border bg-background px-md py-sm text-body-sm text-heading">
              <MarkdownBody content={bullet} emptyLabel="" className="sow-markdown" />
            </li>
          ))}
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
  busy,
  run,
  claudeReady,
}: {
  clientId: string;
  brief: CompanyBrief;
  busy: string | null;
  run: (key: string, work: () => Promise<ActionResult>, ok?: string) => Promise<boolean>;
  claudeReady: boolean;
}) {
  const points = brief.points;
  const [chosen, setChosen] = useState<string[]>(points.chosen);
  const [pitches, setPitches] = useState<Record<string, string>>({});
  useEffect(() => {
    setChosen(points.chosen);
    setPitches(Object.fromEntries(points.scores.map((item) => [item.point, item.pitch])));
  }, [points]);

  const scoreOf = (id: string) => points.scores.find((item) => item.point === id);
  const ordered = [...SELLING_POINTS].sort((a, b) => (scoreOf(b.id)?.score ?? -1) - (scoreOf(a.id)?.score ?? -1));
  const changed =
    chosen.join() !== points.chosen.join() || points.scores.some((item) => (pitches[item.point] ?? item.pitch) !== item.pitch);

  function toggle(id: string) {
    setChosen((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : current.length >= SELLING_POINTS_CHOSEN ? current : [...current, id],
    );
  }

  return (
    <section className={`${card} px-lg py-md`}>
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div>
          <h3 className="text-h4">The 3 strongest selling points</h3>
          <p className="mt-xs max-w-prose text-body-sm text-muted">
            Rupert scores all {SELLING_POINTS.length} for this raise and picks the top {SELLING_POINTS_CHOSEN}. Swap any of them and edit what to say. The narrative leads with these.
          </p>
        </div>
        <button
          type="button"
          className={points.scores.length > 0 ? secondaryButton : primaryButton}
          disabled={busy !== null || !claudeReady}
          onClick={() => void run("points", () => scoreSellingPointsAction(clientId), "Selling points scored. The top three are chosen.")}
        >
          {busy === "points" ? "Scoring…" : points.scores.length > 0 ? "Score again" : "Score selling points"}
        </button>
      </div>

      {points.scores.length > 0 ? (
        <>
          <ol className="mt-md grid gap-sm md:grid-cols-3">
            {chosen.map((id, index) => {
              const point = SELLING_POINTS.find((item) => item.id === id);
              return point ? (
                <li key={id} className="flex flex-col gap-xs rounded-md border border-primary/30 bg-primary-tint px-md py-sm">
                  <p className="text-label uppercase tracking-label text-primary">
                    {index + 1} · score {scoreOf(id)?.score ?? "–"}
                  </p>
                  <p className="text-body text-heading">{point.title}</p>
                  <AutoTextarea
                    className={`${inputClass} bg-surface`}
                    value={pitches[id] ?? ""}
                    aria-label={`What to say: ${point.title}`}
                    onChange={(event) => setPitches((current) => ({ ...current, [id]: event.target.value }))}
                  />
                </li>
              ) : null;
            })}
          </ol>
          <details className="mt-md text-body-sm" open={chosen.length < SELLING_POINTS_CHOSEN}>
            <summary className="cursor-pointer text-primary">All {SELLING_POINTS.length} points, by score</summary>
            <ul className="mt-sm grid gap-xs">
              {ordered.map((point) => {
                const score = scoreOf(point.id);
                const on = chosen.includes(point.id);
                return (
                  <li key={point.id} className="flex items-start gap-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={on}
                      disabled={!on && chosen.length >= SELLING_POINTS_CHOSEN}
                      onChange={() => toggle(point.id)}
                      aria-label={point.title}
                    />
                    <span className={`w-6 shrink-0 text-right ${score && score.score >= 7 ? "text-success" : score && score.score >= 4 ? "text-warning" : "text-muted"}`}>
                      {score?.score ?? "–"}
                    </span>
                    <span>
                      <span className="text-heading">{point.title}</span>
                      {score?.reason ? <span className="text-muted"> · {score.reason}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
          {changed ? (
            <button
              type="button"
              className={`${primaryButton} mt-md`}
              disabled={busy !== null || chosen.length === 0}
              onClick={() => void run("points-save", () => saveSellingPointsAction(clientId, chosen, pitches), "Selling points saved.")}
            >
              Save selling points ({chosen.length} of {SELLING_POINTS_CHOSEN})
            </button>
          ) : null}
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
        onChange(saved.files);
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Upload failed.");
    } finally {
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
        {done ? " (then Rebuild brief, or attach it in the chat)" : ""}
        <input ref={input} type="file" accept=".pdf" multiple className="hidden" onChange={(event) => void upload(event.target.files)} />
        {notice ? <span className="block text-error">{notice}</span> : null}
      </p>
    );
  }

  return (
    <section className={`${card} border-primary/30 px-lg py-md`}>
      <h3 className="text-h4">Founder&apos;s LinkedIn</h3>
      <p className="mt-xs max-w-prose text-body-sm text-muted">
        AI can&apos;t open LinkedIn. Open each founder&apos;s profile, choose More → Save to PDF, and upload them here (you can pick several at once). The brief builds as soon as one is in.
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
          {busy ? "Uploading…" : done ? "Add more PDFs" : "Upload LinkedIn PDFs"}
        </button>
        {!done && !files.skipped ? (
          <button type="button" className={secondaryButton} disabled={disabled || busy} onClick={() => void act(() => skipLinkedinAction(clientId))}>
            Skip, build without it
          </button>
        ) : null}
        <input ref={input} type="file" accept=".pdf" multiple className="hidden" onChange={(event) => void upload(event.target.files)} />
      </div>
      {notice ? <p role="alert" className="mt-sm text-body-sm text-error">{notice}</p> : null}
    </section>
  );
}
