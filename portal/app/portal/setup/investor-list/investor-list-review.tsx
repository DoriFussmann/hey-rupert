"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { askSetupQuestion, respondToSetupStep, saveInvestorFundFlag } from "@/app/portal/setup/actions";
import { QuestionThread } from "@/components/setup/question-thread";
import { TurnBanner } from "@/components/setup/turn-banner";
import { formatDate } from "@/lib/format";
import { BROAD_LABEL } from "@/lib/founder-list-facts";
import { applyFundFlag, type FlagPatch } from "@/lib/investor-flags";
import {
  NOTE_MAX,
  QUESTION_MAX,
  fitTiersFor,
  tierStatsFor,
  type FitTier,
  type InvestorFundFlag,
  type InvestorListSummary,
  type InvestorRow,
  type InvestorVerification,
  type SetupQuestion,
  type TierScheme,
} from "@/lib/setup";

const PAGE_SIZE = 25;

/** A tab of the list: a fit tier, or the broad investors shown apart from the tiers. */
type TabKey = FitTier | "broad";

const BROAD_DETAIL = "Investors with broader mandates. They fit your stage and location, but they are not sector-specific matches.";

const primaryButton =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-primary px-md text-body-sm text-white hover:bg-primary-hover motion-reduce:transition-none";
const secondaryButton =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-border bg-surface px-md text-body-sm text-heading hover:bg-background motion-reduce:transition-none";

type AskMode = "question" | "changes";

const ASK_TEXT: Record<AskMode, { title: (admin: string) => string; detail: string; label: string; send: string }> = {
  question: {
    title: (admin) => `Ask ${admin} a Question`,
    detail: "The answer comes here and by email. You can still confirm the list meanwhile.",
    label: "Your question",
    send: "Send Question",
  },
  changes: {
    title: () => "Request Changes",
    detail: "Rupert updates the list and sends you a new version to confirm. Your notes on funds are included.",
    label: "What should change",
    send: "Send Request",
  },
};

/** The fund's details, for the panel that opens under it. */
function detailRows(row: InvestorRow) {
  return [
    { label: "Firm Type", value: row.fund_type || fundType(row) },
    { label: "Stage", value: row.stage_focus ?? "" },
    { label: "Geography", value: row.geography_focus || row.location || "" },
    { label: "Sector", value: row.sector_focus ?? "" },
    {
      label: "Contacts",
      value: typeof row.contact_count === "number" ? n(row.contact_count) : row.contact,
    },
    ...(row.check_size ? [{ label: "Check Size", value: row.check_size }] : []),
  ];
}
const smallButton =
  "inline-flex min-h-[44px] items-center justify-center rounded-md border border-border bg-surface px-sm text-body-sm text-secondary hover:bg-background hover:text-heading motion-reduce:transition-none";

function n(value: number) {
  return value.toLocaleString("en-US");
}

function fundType(row: InvestorRow) {
  return row.fund_type?.trim() || row.details.split("·")[0]?.trim() || "Other";
}

/** Type and place, for the card's second line. Older lists without a location use their details line. */
function metaLine(row: InvestorRow) {
  if (row.fund_type || row.location) return [fundType(row), row.location?.trim()].filter(Boolean).join(" · ");
  const parts = row.details
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);
  const withoutFounded = parts.filter((part) => !/^founded\b/i.test(part));
  return (withoutFounded.length > 0 ? withoutFounded : parts).slice(0, 2).join(" · ");
}

function notesFromFlags(flags: Record<string, InvestorFundFlag>) {
  const notes: Record<string, string> = {};
  for (const [id, flag] of Object.entries(flags)) {
    const note = flag.note?.trim();
    if (note) notes[id] = note;
  }
  return notes;
}

function checkedLabel(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatDate(value);
}

export function InvestorListReview({
  rows: allRows,
  summary,
  scheme,
  verification,
  flags: initialFlags,
  version,
  open,
  company,
  adminName,
  publishedAt,
  adminNote,
  questions = [],
  intro,
  readOnly,
  heading = "h1",
}: {
  rows: InvestorRow[];
  summary?: InvestorListSummary | null;
  /** The list's tier scheme: three tiers unless it was pushed from the four-tier engine. */
  scheme?: TierScheme;
  verification?: InvestorVerification;
  flags?: Record<string, InvestorFundFlag>;
  version: number;
  /** True while it is the client's turn to confirm. */
  open: boolean;
  company: string;
  adminName: string;
  publishedAt?: string | null;
  adminNote?: string;
  questions?: SetupQuestion[];
  /** One line above the tier cards: what the list is based on. */
  intro?: string;
  /** Preview and view-as: controls stay visible and do not save. */
  readOnly: boolean;
  heading?: "h1" | "p";
}) {
  const rows = useMemo(() => allRows.filter((row) => !row.hidden_duplicate), [allRows]);
  const tiers = fitTiersFor(scheme);
  const router = useRouter();
  const confirmRef = useRef<HTMLDialogElement>(null);
  const askRef = useRef<HTMLDialogElement>(null);
  const searchId = useId();
  const [flags, setFlags] = useState<Record<string, InvestorFundFlag>>(initialFlags ?? {});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [tier, setTier] = useState<TabKey>(1);
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [showExcluded, setShowExcluded] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [shownMessage, setShownMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [askMode, setAskMode] = useState<AskMode | null>(null);
  const [askText, setAskText] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<null | "confirmed" | AskMode>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState<Record<string, FlagPatch>>({});

  const editable = open && !readOnly;
  const blocked = readOnly || pending !== null;
  const dateLabel = checkedLabel(publishedAt ?? undefined);

  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [tier, query, types, showExcluded]);

  useEffect(() => {
    const dialog = confirmRef.current;
    if (!dialog) return;
    if (confirmOpen && !dialog.open) dialog.showModal();
    if (!confirmOpen && dialog.open) dialog.close();
  }, [confirmOpen]);

  useEffect(() => {
    const dialog = askRef.current;
    if (!dialog) return;
    if (askMode && !dialog.open) dialog.showModal();
    if (!askMode && dialog.open) dialog.close();
  }, [askMode]);

  // Excluded funds drop out of the counts as soon as the client excludes them.
  const tierStats = useMemo(
    () => tierStatsFor(rows, flags, tiers, summary, { label: BROAD_LABEL, detail: BROAD_DETAIL }),
    [rows, summary, tiers, flags],
  );

  const inTab = useMemo(
    () => rows.filter((row) => (tier === "broad" ? row.broad : row.tier === tier && !row.broad)),
    [rows, tier],
  );
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of inTab) counts.set(fundType(row), (counts.get(fundType(row)) ?? 0) + 1);
    return Array.from(counts.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
  }, [inTab]);

  const visible = useMemo(() => {
    const selected = new Set(types);
    const needle = query.trim().toLowerCase();
    return inTab.filter((row) => {
      if (!showExcluded && flags[row.id]?.excluded && !saveFailed[row.id]) return false;
      if (needle && !row.fund_name.toLowerCase().includes(needle)) return false;
      if (selected.size > 0 && !selected.has(fundType(row))) return false;
      return true;
    });
  }, [inTab, flags, showExcluded, query, types, saveFailed]);

  const shown = visible.slice(0, limit);
  const confirming = rows.filter((row) => !flags[row.id]?.excluded).length;
  const excluded = rows.filter((row) => flags[row.id]?.excluded).length;
  const known = rows.filter((row) => flags[row.id]?.known).length;
  const activeTab = tierStats.find((entry) => entry.tier === tier) ?? tierStats[0];

  function noteValue(id: string) {
    return noteDrafts[id] ?? flags[id]?.note ?? "";
  }

  async function commit(id: string, patch: FlagPatch) {
    let previous: InvestorFundFlag | undefined;
    setFlags((current) => {
      previous = current[id];
      return applyFundFlag(current, id, patch);
    });
    setSaved((current) => ({ ...current, [id]: "" }));
    setSaveFailed((current) => {
      if (!current[id]) return current;
      const copy = { ...current };
      delete copy[id];
      return copy;
    });
    if (!editable) return;
    const result = await saveInvestorFundFlag({ version, fundId: id, ...patch });
    if (!result.ok) {
      setFlags((current) => {
        const copy = { ...current };
        if (previous) copy[id] = previous;
        else delete copy[id];
        return copy;
      });
      setError(result.error);
      if (result.error === "Couldn't save, try again") {
        setSaveFailed((current) => ({ ...current, [id]: patch }));
      }
      return;
    }
    setError(null);
    setSaved((current) => ({ ...current, [id]: "Saved" }));
  }

  function saveNote(id: string) {
    const next = noteValue(id);
    if (next.trim() === (flags[id]?.note ?? "")) {
      setSaved((current) => ({ ...current, [id]: "Saved" }));
      return;
    }
    void commit(id, { note: next });
  }

  async function respond() {
    if (blocked) return;
    setPending("confirmed");
    setError(null);
    try {
      const result = await respondToSetupStep({
        step: "investor_list",
        version,
        decision: "confirmed",
        note: "",
        itemNotes: notesFromFlags(flags),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(null);
    }
  }

  async function sendAsk() {
    if (blocked || !askMode) return;
    const itemNotes = notesFromFlags(flags);
    if (!askText.trim() && (askMode === "question" || Object.keys(itemNotes).length === 0)) {
      setError(askMode === "question" ? "Write your question first." : "Write what should change first.");
      return;
    }
    setPending(askMode);
    setError(null);
    try {
      const result =
        askMode === "question"
          ? await askSetupQuestion({ step: "investor_list", version, question: askText })
          : await respondToSetupStep({
              step: "investor_list",
              version,
              decision: "changes_requested",
              note: askText,
              itemNotes,
            });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (askMode === "question") setAsked(`Question sent. ${adminName} will answer here and by email.`);
      setAskMode(null);
      setAskText("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(null);
    }
  }

  function onTabsKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = tierStats.findIndex((entry) => entry.tier === tier);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tierStats.length - 1
          : event.key === "ArrowRight"
            ? (index + 1) % tierStats.length
            : (index - 1 + tierStats.length) % tierStats.length;
    const next = tierStats[nextIndex].tier;
    setTier(next);
    setTypes([]);
    document.getElementById(`investor-tier-tab-${next}`)?.focus();
  }

  const Title = heading === "h1" ? "h1" : "p";
  const ran = verification?.verification_ran === true;

  return (
    <div
      className={
        open
          ? "pb-40 scroll-pb-40 md:scroll-pt-24 md:pb-0 md:scroll-pb-0 [&_a]:scroll-mb-40 [&_button]:scroll-mb-40 [&_input]:scroll-mb-40 [&_textarea]:scroll-mb-40 md:[&_a]:scroll-mb-0 md:[&_a]:scroll-mt-24 md:[&_button]:scroll-mb-0 md:[&_button]:scroll-mt-24 md:[&_input]:scroll-mb-0 md:[&_input]:scroll-mt-24 md:[&_textarea]:scroll-mb-0 md:[&_textarea]:scroll-mt-24"
          : undefined
      }
    >
      <header>
        <Title className="text-h2 text-heading">Your Investor List</Title>
        <p className="mt-xs text-body-sm text-secondary">
          {company} · prepared by {adminName}
          {dateLabel ? ` · ${dateLabel}` : ""}
        </p>
      </header>

      {open ? (
        <div className="mt-lg">
          <TurnBanner
            owner="client"
            title="Review the list, then confirm it or ask a question. Outreach starts only after you confirm, and you'll approve every email before it's sent."
          />
        </div>
      ) : null}

      {open && adminNote?.trim() ? (
        <section className="mt-lg rounded-card border border-border bg-surface px-md py-md">
          <p className="text-body-sm text-heading">From {adminName}</p>
          <p className="mt-xs whitespace-pre-wrap text-body-sm text-body">{adminNote}</p>
        </section>
      ) : null}

      {open ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface px-md py-sm shadow-[0_-8px_24px_rgba(0,0,0,0.08)] md:sticky md:inset-x-auto md:bottom-auto md:top-0 md:mt-lg md:rounded-card md:border md:shadow-none">
          <div className="flex flex-wrap items-center gap-sm">
            <p className="min-w-[12rem] flex-1 text-body-sm text-heading" aria-live="polite">
              Confirming {n(confirming)} funds · {n(excluded)} excluded
            </p>
            <button
              type="button"
              className={primaryButton}
              aria-disabled={blocked || undefined}
              onClick={() => {
                if (blocked) return;
                setConfirmOpen(true);
              }}
            >
              {pending === "confirmed" ? "Confirming…" : "Confirm List"}
            </button>
            <button
              type="button"
              className={secondaryButton}
              aria-disabled={blocked || undefined}
              onClick={() => {
                if (blocked) return;
                setError(null);
                setAsked(null);
                setAskMode("question");
              }}
            >
              Ask a Question
            </button>
            <button
              type="button"
              className={secondaryButton}
              aria-disabled={blocked || undefined}
              onClick={() => {
                if (blocked) return;
                setError(null);
                setAsked(null);
                setAskMode("changes");
              }}
            >
              Request Changes
            </button>
            {readOnly ? (
              <p className="text-body-sm text-secondary">Preview: actions disabled</p>
            ) : null}
          </div>
          {asked ? (
            <p role="status" className="mt-sm text-body-sm text-success">
              {asked}
            </p>
          ) : null}
          {error && !askMode && !confirmOpen ? (
            <p role="alert" className="mt-sm text-body-sm text-error">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      <QuestionThread questions={questions} adminName={adminName} />

      <section className="mt-lg" aria-labelledby="tier-summary-heading">
        <h2 id="tier-summary-heading" className="text-h3 text-heading">
          Tier Summary
        </h2>
        {intro ? <p className="mt-xs max-w-prose text-body-sm text-secondary">{intro}</p> : null}
        <ul className={`mt-md grid gap-sm ${tierStats.length >= 4 ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-3"}`}>
          {tierStats.map((entry) => (
            <li key={entry.tier} className="rounded-card border border-border bg-surface px-md py-sm">
              <p className="text-body-sm font-medium text-heading">{entry.label}</p>
              <p className="mt-xs text-label text-secondary">{entry.detail}</p>
              <p className="mt-xs text-body-sm text-heading">
                {n(entry.funds)} fund{entry.funds === 1 ? "" : "s"}
                {entry.contacts !== null
                  ? ` · ${n(entry.contacts)} contact${entry.contacts === 1 ? "" : "s"}`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {ran && verification ? (
        <section className="mt-lg rounded-card border border-border bg-surface px-md py-md" aria-labelledby="quality-check-heading">
          <h2 id="quality-check-heading" className="text-h4 text-heading">
            Quality Check
          </h2>
          <p className="mt-xs text-body-sm text-body">
            Before sharing this list we checked a sample of {n(verification.sample_size ?? 0)}{" "}
            contacts: {n(verification.firms_confirmed_active ?? 0)} of{" "}
            {n(verification.firms_checked ?? 0)} firms confirmed active, and{" "}
            {n(verification.deliverable_rate ?? 0)}% of emails verified deliverable.
            {verification.excludes_invalid
              ? " Contacts that failed are removed from outreach."
              : ""}
          </p>
          {checkedLabel(verification.verified_at) ? (
            <p className="mt-xs text-body-sm text-secondary">
              Checked {checkedLabel(verification.verified_at)}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="mt-lg" aria-labelledby="investors-heading">
        <h2 id="investors-heading" className="text-h3 text-heading">
          Investors
        </h2>
        <div
          className="mt-md flex flex-wrap gap-sm"
          role="tablist"
          aria-label="Fit tiers"
          onKeyDown={onTabsKeyDown}
        >
          {tierStats.map((entry) => {
            const selected = tier === entry.tier;
            return (
              <button
                key={entry.tier}
                type="button"
                id={`investor-tier-tab-${entry.tier}`}
                role="tab"
                aria-selected={selected}
                aria-controls="investor-tier-panel"
                tabIndex={selected ? 0 : -1}
                className={`min-h-[44px] rounded-md border px-md text-body-sm motion-reduce:transition-none ${
                  selected
                    ? "border-heading bg-primary-tint text-heading"
                    : "border-border bg-surface text-secondary"
                }`}
                onClick={() => {
                  setTier(entry.tier);
                  setTypes([]);
                }}
              >
                {entry.label} ({n(entry.funds)})
              </button>
            );
          })}
        </div>

        <div
          id="investor-tier-panel"
          role="tabpanel"
          aria-labelledby={`investor-tier-tab-${tier}`}
          className="mt-md"
        >
          <div className="flex flex-wrap items-end gap-sm">
            <label className="block min-w-[16rem] flex-1 text-body-sm text-heading" htmlFor={searchId}>
              Search Funds by Name
              <input
                id={searchId}
                type="search"
                value={query}
                placeholder="Fund name"
                onChange={(event) => setQuery(event.target.value)}
                className="mt-xs min-h-[44px] w-full rounded-md border border-border bg-surface px-md py-sm text-body-sm text-body"
              />
            </label>
            <button
              type="button"
              className={secondaryButton}
              aria-pressed={showExcluded}
              onClick={() => setShowExcluded((current) => !current)}
            >
              {showExcluded ? "✓ Show Excluded" : "Show Excluded"}
            </button>
          </div>
          {typeCounts.length > 0 ? (
            <div className="mt-md flex flex-wrap gap-sm" role="group" aria-label={`${activeTab.label} fund types`}>
              {typeCounts.map(([type, count]) => {
                const pressed = types.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    className={`min-h-[44px] rounded-md border px-md text-body-sm motion-reduce:transition-none ${
                      pressed ? "border-heading bg-surface text-heading" : "border-border bg-surface text-secondary"
                    }`}
                    aria-pressed={pressed}
                    onClick={() =>
                      setTypes((current) =>
                        current.includes(type)
                          ? current.filter((item) => item !== type)
                          : [...current, type],
                      )
                    }
                  >
                    {pressed ? "✓ " : ""}
                    {type} {n(count)}
                  </button>
                );
              })}
            </div>
          ) : null}

          <p className="sr-only" aria-live="polite">
            {shownMessage}
          </p>

          {shown.length === 0 ? (
            <p className="mt-md text-body-sm text-secondary">No funds match.</p>
          ) : (
            <ul className="mt-md space-y-md">
              {shown.map((row) => {
                const flag = flags[row.id] ?? {};
                const meta = metaLine(row);
                if (flag.excluded) {
                  return (
                    <li key={row.id} className="rounded-card border border-border bg-surface px-md py-sm">
                      <div className="flex flex-wrap items-center justify-between gap-sm">
                        <h3 className="text-body-sm font-medium text-heading">{row.fund_name}</h3>
                        <span className="text-body-sm text-muted">Excluded</span>
                        <button
                          type="button"
                          className={secondaryButton}
                          aria-disabled={blocked || undefined}
                          onClick={() => {
                            if (blocked) return;
                            void commit(row.id, { excluded: false });
                          }}
                        >
                          Undo
                        </button>
                      </div>
                      {saveFailed[row.id] ? (
                        <div className="mt-md flex flex-wrap items-center gap-sm">
                          <p role="alert" className="text-body text-error">
                            Couldn&apos;t save, try again
                          </p>
                          <button
                            type="button"
                            className={secondaryButton}
                            onClick={() => {
                              const patch = saveFailed[row.id];
                              if (patch) void commit(row.id, patch);
                            }}
                          >
                            Retry
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                }
                const writing = noteOpen[row.id] || Boolean(noteValue(row.id));
                const isOpen = Boolean(expanded[row.id]);
                return (
                  <li key={row.id} className="rounded-card border border-border bg-surface px-md py-sm">
                    <div className="flex flex-wrap items-center justify-between gap-x-md gap-y-xs">
                      <div className="min-w-[14rem] flex-1">
                        <h3 className="flex flex-wrap items-center gap-x-sm text-body-sm text-heading">
                          <button
                            type="button"
                            className="inline-flex min-h-[44px] items-center gap-xs text-left font-medium text-heading hover:text-primary"
                            aria-expanded={isOpen}
                            aria-controls={`fund-details-${row.id}`}
                            onClick={() => setExpanded((current) => ({ ...current, [row.id]: !isOpen }))}
                          >
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 20 20"
                              className={`h-4 w-4 shrink-0 text-muted transition-transform motion-reduce:transition-none ${isOpen ? "rotate-90" : ""}`}
                              fill="none"
                            >
                              <path d="m8 5 5 5-5 5" stroke="currentColor" strokeWidth="1.5" />
                            </svg>
                            {row.fund_name}
                          </button>
                          {row.website ? (
                            <a
                              href={row.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-primary"
                            >
                              <span className="sr-only">{row.fund_name} website (opens in new tab)</span>
                              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
                                <path d="M8 5H5v10h10v-3M11 4h5v5M10 10l6-6" stroke="currentColor" strokeWidth="1.5" />
                              </svg>
                            </a>
                          ) : null}
                        </h3>
                        {meta ? <p className="text-label text-secondary">{meta}</p> : null}
                      </div>
                      {open ? (
                        <div className="flex flex-wrap gap-xs">
                          <button
                            type="button"
                            className={smallButton}
                            aria-disabled={blocked || undefined}
                            onClick={() => {
                              if (blocked) return;
                              void commit(row.id, {
                                excluded: true,
                                ...(noteDrafts[row.id] !== undefined ? { note: noteDrafts[row.id] } : {}),
                              });
                            }}
                          >
                            Exclude
                          </button>
                          <button
                            type="button"
                            className={`${smallButton} ${flag.known ? "border-heading text-heading" : ""}`}
                            aria-pressed={Boolean(flag.known)}
                            aria-disabled={blocked || undefined}
                            onClick={() => {
                              if (blocked) return;
                              void commit(row.id, {
                                known: !flag.known,
                                ...(noteDrafts[row.id] !== undefined ? { note: noteDrafts[row.id] } : {}),
                              });
                            }}
                          >
                            {flag.known ? "✓ I know them" : "I know them"}
                          </button>
                          {!writing ? (
                            <button
                              type="button"
                              className={smallButton}
                              aria-disabled={blocked || undefined}
                              onClick={() => {
                                if (blocked) return;
                                setNoteOpen((current) => ({ ...current, [row.id]: true }));
                              }}
                            >
                              Add note
                            </button>
                          ) : null}
                        </div>
                      ) : flag.known ? (
                        <p className="text-body-sm text-heading">I know them</p>
                      ) : null}
                    </div>
                    {isOpen ? (
                      <dl
                        id={`fund-details-${row.id}`}
                        className="mt-sm grid gap-x-md gap-y-xs rounded-md border border-border bg-background px-md py-sm text-body-sm sm:grid-cols-[8rem_1fr]"
                      >
                        {detailRows(row).map((item) => (
                          <div key={item.label} className="contents">
                            <dt className="text-muted">{item.label}</dt>
                            <dd className="text-heading">{item.value || "Not listed"}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {open ? null : flag.note ? (
                      <p className="mt-sm text-body-sm text-body">
                        <span className="text-heading">Note: </span>
                        {flag.note}
                      </p>
                    ) : null}
                    {open && writing ? (
                      <div className="mt-md">
                        <label className="block text-body-sm text-heading" htmlFor={`note-${row.id}`}>
                          Note on {row.fund_name}
                          <textarea
                            id={`note-${row.id}`}
                            className="mt-xs w-full rounded-md border border-border bg-background px-md py-sm text-body-sm text-body"
                            rows={3}
                            maxLength={NOTE_MAX}
                            value={noteValue(row.id)}
                            readOnly={!editable}
                            onChange={(event) => {
                              const value = event.target.value;
                              setNoteDrafts((current) => ({ ...current, [row.id]: value }));
                              setSaved((current) => ({ ...current, [row.id]: "" }));
                            }}
                            onBlur={(event) => {
                              const next = event.relatedTarget;
                              const rowEl = event.currentTarget.closest("li");
                              if (
                                next instanceof HTMLElement &&
                                rowEl?.contains(next) &&
                                next.tagName === "BUTTON"
                              ) {
                                return;
                              }
                              if (editable) saveNote(row.id);
                            }}
                          />
                        </label>
                        <div className="mt-sm flex flex-wrap items-center gap-sm">
                          <button
                            type="button"
                            className={secondaryButton}
                            aria-disabled={blocked || undefined}
                            onClick={() => {
                              if (!editable) return;
                              saveNote(row.id);
                            }}
                          >
                            Save
                          </button>
                          <p className="text-body-sm text-secondary" aria-live="polite">
                            {saved[row.id] ?? ""}
                          </p>
                        </div>
                      </div>
                    ) : null}
                    {saveFailed[row.id] ? (
                      <div className="mt-md flex flex-wrap items-center gap-sm">
                        <p role="alert" className="text-body text-error">
                          Couldn&apos;t save, try again
                        </p>
                        <button
                          type="button"
                          className={secondaryButton}
                          onClick={() => {
                            const patch = saveFailed[row.id];
                            if (patch) void commit(row.id, patch);
                          }}
                        >
                          Retry
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {shown.length < visible.length ? (
            <button
              type="button"
              className={`${secondaryButton} mt-md`}
              onClick={() => {
                const next = Math.min(visible.length, limit + PAGE_SIZE);
                setLimit(next);
                setShownMessage(`Showing ${n(next)} of ${n(visible.length)} funds`);
              }}
            >
              Show 25 more
            </button>
          ) : null}
        </div>
      </section>

      <dialog
        ref={confirmRef}
        aria-labelledby="confirm-list-title"
        className="w-[min(100%,36rem)] rounded-card border border-border bg-surface p-lg text-body-sm text-body"
        onClose={() => setConfirmOpen(false)}
      >
        <h2 id="confirm-list-title" className="text-h3 text-heading">
          Confirm This List?
        </h2>
        <ul className="mt-md list-disc space-y-xs pl-md text-body-sm text-heading">
          {tierStats.map((entry) => (
            <li key={entry.tier}>
              {entry.label}: {n(entry.funds)} fund{entry.funds === 1 ? "" : "s"}
            </li>
          ))}
          <li>Excluded: {n(excluded)}</li>
          <li>I know them: {n(known)}</li>
        </ul>
        {error ? (
          <p role="alert" className="mt-md text-body-sm text-error">
            {error}
          </p>
        ) : null}
        <div className="mt-lg flex flex-wrap gap-sm">
          <button type="button" className={primaryButton} onClick={() => void respond()}>
            {pending === "confirmed" ? "Confirming…" : "Confirm List"}
          </button>
          <button type="button" className={secondaryButton} onClick={() => setConfirmOpen(false)}>
            Cancel
          </button>
        </div>
      </dialog>

      <dialog
        ref={askRef}
        aria-labelledby="ask-question-title"
        className="w-[min(100%,36rem)] rounded-card border border-border bg-surface p-lg text-body-sm text-body"
        onClose={() => setAskMode(null)}
      >
        {askMode ? (
          <>
            <h2 id="ask-question-title" className="text-h3 text-heading">
              {ASK_TEXT[askMode].title(adminName)}
            </h2>
            <p className="mt-xs text-body-sm text-muted">{ASK_TEXT[askMode].detail}</p>
            <label className="mt-md block text-body-sm text-heading" htmlFor="investor-question">
              {ASK_TEXT[askMode].label}
              <textarea
                id="investor-question"
                className="mt-xs w-full rounded-md border border-border bg-background px-md py-sm text-body-sm text-body"
                rows={4}
                maxLength={askMode === "question" ? QUESTION_MAX : NOTE_MAX}
                value={askText}
                onChange={(event) => setAskText(event.target.value)}
              />
            </label>
            {error ? (
              <p role="alert" className="mt-md text-body-sm text-error">
                {error}
              </p>
            ) : null}
            <div className="mt-lg flex flex-wrap gap-sm">
              <button type="button" className={primaryButton} onClick={() => void sendAsk()}>
                {pending === askMode ? "Sending…" : ASK_TEXT[askMode].send}
              </button>
              <button type="button" className={secondaryButton} onClick={() => setAskMode(null)}>
                Cancel
              </button>
            </div>
          </>
        ) : null}
      </dialog>
    </div>
  );
}
