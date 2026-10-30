"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  buildBriefAction,
  chooseDeckTopicsAction,
  restoreBriefVersionAction,
  saveBriefSectionsAction,
  saveDeckWriteupsAction,
  scoreDeckAction,
  writeDeckFeedbackAction,
  writeNarrativeFromBriefAction,
} from "@/app/admin/brief-actions";
import { FramingChat } from "@/app/admin/clients/[id]/framing/framing-chat";
import { inputClass, primaryButton, secondaryButton } from "@/app/admin/clients/[id]/setup/shared";
import { AutoTextarea } from "@/components/email-body-field";
import { MarkdownBody } from "@/components/markdown-body";
import {
  BRIEF_SECTIONS,
  DECK_TOPICS,
  DECK_TOPICS_PER_CLIENT,
  briefQuestions,
  deckTopic,
  type BriefSectionKey,
  type CompanyBrief,
  type FounderQuestion,
  type FramingMessage,
} from "@/lib/brief";
import type { BriefVersionRow } from "@/lib/brief-server";
import { formatDateAtTime } from "@/lib/format";

type Notice = { kind: "ok" | "error"; text: string } | null;
type ActionResult = { ok: true; brief: CompanyBrief } | { ok: false; error: string };

const card = "rounded-card border border-border bg-surface";
const label = "text-label uppercase tracking-label text-muted";

export function FramingRoom({
  clientId,
  company,
  initialBrief,
  initialVersions,
  initialMessages,
  founderQuestions,
  canBuild,
  buildNote,
  claudeReady,
}: {
  clientId: string;
  company: string;
  initialBrief: CompanyBrief | null;
  initialVersions: BriefVersionRow[];
  initialMessages: FramingMessage[];
  founderQuestions: FounderQuestion[];
  canBuild: boolean;
  buildNote: string | null;
  claudeReady: boolean;
}) {
  const [brief, setBrief] = useState<CompanyBrief | null>(initialBrief);
  const [versions, setVersions] = useState<BriefVersionRow[]>(initialVersions);
  const [messages, setMessages] = useState<FramingMessage[]>(initialMessages);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const autoStarted = useRef(false);

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
  useEffect(() => {
    if (autoStarted.current || brief || !canBuild || !claudeReady) return;
    autoStarted.current = true;
    void run("build", () => buildBriefAction(clientId), "Brief built. Read it, then use the chat to decide the framing.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const building = busy === "build";

  return (
    <div className="grid gap-lg lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
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
                    : canBuild
                      ? "Not built yet."
                      : (buildNote ?? "Not available yet.")}
              </p>
              {!brief && buildNote && canBuild ? <p className="mt-xs text-body-sm text-warning">{buildNote}</p> : null}
            </div>
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

        {brief
          ? BRIEF_SECTIONS.map((section) => (
              <SectionCard
                key={section.key}
                sectionKey={section.key}
                title={section.title}
                hint={section.hint}
                value={brief.sections[section.key]}
                disabled={busy !== null}
                onSave={(value) =>
                  run(section.key, () => saveBriefSectionsAction(clientId, { ...brief.sections, [section.key]: value }, `Edited ${section.title}.`), `${section.title} saved.`)
                }
              />
            ))
          : null}

        {brief ? (
          <>
            <DeckPanel clientId={clientId} brief={brief} busy={busy} run={run} claudeReady={claudeReady} />
            <OutputsPanel clientId={clientId} brief={brief} founderQuestions={founderQuestions} busy={busy} setBusy={setBusy} claudeReady={claudeReady} />
          </>
        ) : null}
      </div>

      <FramingChat
        clientId={clientId}
        company={company}
        messages={messages}
        onMessages={setMessages}
        onBrief={adopt}
        disabled={!claudeReady || building}
      />
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
  sectionKey: BriefSectionKey;
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
        <div>
          <h3 className="text-h4">{title}</h3>
          <p className="mt-xs text-body-sm text-muted">{hint}</p>
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
