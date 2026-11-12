"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { askSetupQuestion, respondToSetupStep } from "@/app/portal/setup/actions";
import { QuestionThread } from "@/components/setup/question-thread";
import { TurnBanner } from "@/components/setup/turn-banner";
import { DealsDeckButton } from "@/components/setup/deals-deck";
import { SummaryView } from "@/app/admin/matching/summary-view";
import type { DealsDeck } from "@/lib/match/deals/core";
import type { InvestorSummaries, SetupQuestion } from "@/lib/setup";

const primaryButton =
  "inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-md py-sm text-body-sm text-white transition-colors duration-hover hover:bg-primary-hover disabled:opacity-40 aria-disabled:opacity-40";
const secondaryButton =
  "inline-flex min-h-[44px] items-center justify-center rounded-md border border-border bg-surface px-md py-sm text-body-sm text-secondary transition-colors duration-hover hover:text-heading disabled:opacity-40 aria-disabled:opacity-40";

type Mode = "question" | "changes" | "confirm";

/**
 * The founder's view of the new matching: the Matching Summary and the
 * Competitive Landscape Overview, with Confirm, Ask a Question or Comment,
 * and Request Changes, and an offer to go through it on a call. Under the
 * summaries, the Competitive Landscape & Deals deck when one was prepared.
 */
export function SummariesReview({
  summaries,
  deck = null,
  version,
  open,
  company,
  adminName,
  publishedAt,
  adminNote,
  questions = [],
  readOnly = false,
  heading = "h1",
}: {
  summaries: InvestorSummaries;
  /** The Competitive Landscape & Deals deck, when one was prepared for this client. */
  deck?: DealsDeck | null;
  version: number;
  /** The client's turn: the actions show. */
  open: boolean;
  company: string;
  adminName: string;
  publishedAt?: string | null;
  adminNote?: string;
  questions?: SetupQuestion[];
  /** Rupert previewing: nothing can be sent. */
  readOnly?: boolean;
  heading?: "h1" | "p";
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const Title = heading;
  const date = publishedAt && !Number.isNaN(new Date(publishedAt).getTime())
    ? new Date(publishedAt).toLocaleDateString("en-US", { dateStyle: "medium" })
    : "";

  async function send() {
    if (readOnly || !mode) return;
    if (mode !== "confirm" && !text.trim()) {
      setError(mode === "question" ? "Write your question or comment first." : "Write what should change first.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result =
        mode === "question"
          ? await askSetupQuestion({ step: "investor_list", version, question: text })
          : await respondToSetupStep({ step: "investor_list", version, decision: mode === "confirm" ? "confirmed" : "changes_requested", note: mode === "confirm" ? "" : text, itemNotes: {} });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(mode === "question" ? `Sent. ${adminName} will answer here and by email.` : null);
      setMode(null);
      setText("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  const pick = (next: Mode) => {
    if (readOnly) return;
    setError(null);
    setDone(null);
    setMode(mode === next ? null : next);
  };

  return (
    <div>
      <header>
        <Title className="text-h2 text-heading">Your Investor Matching</Title>
        <p className="mt-xs text-body-sm text-secondary">
          {company} · prepared by {adminName}
          {date ? ` · ${date}` : ""}
        </p>
      </header>

      {open ? (
        <div className="mt-lg">
          <TurnBanner
            owner="client"
            title="Review how your investors were matched, then confirm, comment or ask a question. Outreach starts only after you confirm, and you'll approve every email before it's sent."
          />
        </div>
      ) : null}

      {open && adminNote?.trim() ? (
        <section className="mt-lg rounded-card border border-border bg-surface px-md py-md">
          <p className="text-body-sm text-heading">From {adminName}</p>
          <p className="mt-xs whitespace-pre-wrap text-body-sm text-body">{adminNote}</p>
        </section>
      ) : null}

      <QuestionThread questions={questions} adminName={adminName} />

      <div className="mt-lg space-y-lg">
        <SummaryView summary={summaries.matching} />
        {summaries.landscape ? <SummaryView summary={summaries.landscape} /> : null}
        {summaries.peers ? <SummaryView summary={summaries.peers} /> : null}
        {deck ? <DealsDeckButton deck={deck} company={company} /> : null}
      </div>

      <p className="mt-lg text-body-sm text-secondary">
        Want to go through it together? Use <span className="text-heading">Book a call</span> in the left panel to pick a time with {adminName}.
      </p>

      {open ? (
        <section aria-label="Your response" className="mt-md rounded-card border border-border bg-surface px-md py-md">
          <div className="flex flex-wrap items-center gap-sm">
            <button type="button" className={primaryButton} aria-disabled={readOnly || undefined} aria-pressed={mode === "confirm"} onClick={() => pick("confirm")}>
              Confirm
            </button>
            <button type="button" className={secondaryButton} aria-disabled={readOnly || undefined} aria-pressed={mode === "question"} onClick={() => pick("question")}>
              Ask a Question or Comment
            </button>
            <button type="button" className={secondaryButton} aria-disabled={readOnly || undefined} aria-pressed={mode === "changes"} onClick={() => pick("changes")}>
              Request Changes
            </button>
            {readOnly ? <p className="text-body-sm text-secondary">Preview: actions disabled</p> : null}
          </div>
          {mode === "confirm" ? (
            <div className="mt-md">
              <p className="text-body-sm text-body">
                Confirm the matching? {adminName} then writes the outreach emails, and you approve them before anything is sent.
              </p>
              <button type="button" className={`${primaryButton} mt-sm`} disabled={pending} onClick={() => void send()}>
                {pending ? "Confirming…" : "Yes, confirm"}
              </button>
            </div>
          ) : mode ? (
            <div className="mt-md">
              <label htmlFor="summaries-text" className="text-body-sm text-heading">
                {mode === "question" ? `Your question or comment for ${adminName}` : "What should change?"}
              </label>
              <textarea
                id="summaries-text"
                className="mt-xs min-h-[100px] w-full resize-y rounded-md border border-border bg-background px-sm py-sm text-body-sm text-body outline-none focus:border-primary"
                maxLength={2000}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button type="button" className={`${primaryButton} mt-sm`} disabled={pending} onClick={() => void send()}>
                {pending ? "Sending…" : mode === "question" ? "Send" : "Send Request"}
              </button>
            </div>
          ) : null}
          {done ? <p role="status" className="mt-sm text-body-sm text-success">{done}</p> : null}
          {error ? <p role="alert" className="mt-sm text-body-sm text-error">{error}</p> : null}
        </section>
      ) : null}
    </div>
  );
}
