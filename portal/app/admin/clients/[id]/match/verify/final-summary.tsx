"use client";

import { useMemo, useState } from "react";
import { applyVerifyActions } from "@/app/admin/verify-actions";
import {
  cardClass,
  errorText,
  inputClass,
  labelClass,
  n,
  primaryButton,
  smallButton,
} from "@/app/admin/clients/[id]/match/ui";
import {
  EvidenceLinks,
  StatusBadge,
  StatusCounts,
  evidenceOf,
  reasonOf,
} from "@/app/admin/clients/[id]/match/verify/verify-parts";
import {
  ACTION_LABEL,
  formatDuration,
  formatUsd,
  type ActionInput,
  type ContactResult,
  type RunStats,
  type VerifyAction,
} from "@/lib/match/verify";

const PAGE = 50;
const ACTIONS: VerifyAction[] = ["remove", "keep", "update_email", "update_name", "update_firm"];

type Draft = ActionInput & { include: boolean };

function draftFor(result: ContactResult): Draft {
  const suggestion = result.suggestion;
  const action = suggestion?.action ?? "keep";
  return {
    id: result.contact.id,
    include: !result.decision && !result.corrected,
    action,
    email: suggestion?.email || result.contact.email,
    firstName: result.contact.first,
    lastName: result.contact.last,
    title: action === "update_firm" ? suggestion?.title ?? "" : result.contact.title,
    newFirm: suggestion?.newFirm ?? "",
    newFirmWebsite: suggestion?.newFirmWebsite ?? "",
  };
}

export type ContactUpdate = { id: string; decision: "keep" | "remove" | null; corrected: boolean };

function doneLabel(result: ContactResult) {
  if (result.decision === "remove") return "Removed for this client";
  if (result.decision === "keep") return "Kept";
  if (result.corrected) return "Fix saved";
  return null;
}

function Fields({ draft, onChange, name }: { draft: Draft; onChange: (patch: Partial<Draft>) => void; name: string }) {
  if (draft.action === "update_email") {
    return (
      <input
        type="email"
        aria-label={`New email for ${name}`}
        className={inputClass}
        value={draft.email ?? ""}
        maxLength={254}
        onChange={(event) => onChange({ email: event.target.value })}
      />
    );
  }
  if (draft.action === "update_name") {
    return (
      <div className="grid gap-xs sm:grid-cols-3">
        <input aria-label={`First name for ${name}`} placeholder="First name" className={inputClass} value={draft.firstName ?? ""} maxLength={100} onChange={(event) => onChange({ firstName: event.target.value })} />
        <input aria-label={`Last name for ${name}`} placeholder="Last name" className={inputClass} value={draft.lastName ?? ""} maxLength={100} onChange={(event) => onChange({ lastName: event.target.value })} />
        <input aria-label={`Title for ${name}`} placeholder="Title" className={inputClass} value={draft.title ?? ""} maxLength={200} onChange={(event) => onChange({ title: event.target.value })} />
      </div>
    );
  }
  if (draft.action === "update_firm") {
    return (
      <div className="grid gap-xs sm:grid-cols-3">
        <input aria-label={`New firm for ${name}`} placeholder="New firm" className={inputClass} value={draft.newFirm ?? ""} maxLength={200} onChange={(event) => onChange({ newFirm: event.target.value })} />
        <input aria-label={`New firm website for ${name}`} placeholder="Website" className={inputClass} value={draft.newFirmWebsite ?? ""} maxLength={300} onChange={(event) => onChange({ newFirmWebsite: event.target.value })} />
        <input aria-label={`Title at the new firm for ${name}`} placeholder="Title there" className={inputClass} value={draft.title ?? ""} maxLength={200} onChange={(event) => onChange({ title: event.target.value })} />
      </div>
    );
  }
  return null;
}

const HELP: Record<VerifyAction, string> = {
  remove: "Off this client's list; the next-best contact at the fund moves up. Flagged for next time.",
  keep: "Stays on the list as is.",
  update_email: "Fixes the email for every client.",
  update_name: "Fixes the name and title for every client.",
  update_firm: "Out of this fund for every client; added to New leads in the Fund Database.",
};

/** Everything checked: totals, and an action for every contact that isn't Clean. */
export function FinalSummary({
  clientId,
  title,
  results,
  stats,
  onUpdated,
}: {
  clientId: string;
  title: string;
  results: ContactResult[];
  stats: RunStats | null;
  onUpdated: (updates: ContactUpdate[]) => void;
}) {
  const problems = useMemo(
    () => results.filter((result) => result.status && result.status !== "clean"),
    [results],
  );
  const unchecked = results.filter((result) => !result.status).length;
  const reused = results.filter((result) => result.reused).length;
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [shown, setShown] = useState(PAGE);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const draftOf = (result: ContactResult) => drafts[result.contact.id] ?? draftFor(result);
  const update = (result: ContactResult, patch: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [result.contact.id]: { ...draftOf(result), ...patch } }));
  const selected = problems.map(draftOf).filter((draft) => draft.include);

  async function apply() {
    setPending(true);
    setNotice(null);
    try {
      const items: ActionInput[] = selected.map((draft) => ({
        id: draft.id,
        action: draft.action,
        email: draft.email,
        firstName: draft.firstName,
        lastName: draft.lastName,
        title: draft.title,
        newFirm: draft.newFirm,
        newFirmWebsite: draft.newFirmWebsite,
      }));
      const result = await applyVerifyActions(clientId, items);
      if (!result.ok) {
        setNotice({ kind: "error", text: result.error });
        return;
      }
      onUpdated(result.updated);
      setDrafts((current) => {
        const next = { ...current };
        for (const item of result.updated) {
          if (next[item.id]) next[item.id] = { ...next[item.id], include: false };
        }
        return next;
      });
      const skipped = items.length - result.updated.length;
      setNotice({
        kind: "ok",
        text: `${n(result.updated.length)} action${result.updated.length === 1 ? "" : "s"} saved. The match was re-run, so removed contacts are replaced by the next person at each fund.${
          skipped > 0 ? ` ${n(skipped)} contact${skipped === 1 ? " is" : "s are"} no longer in the match and ${skipped === 1 ? "was" : "were"} skipped.` : ""
        }`,
      });
    } catch (err) {
      setNotice({ kind: "error", text: errorText(err, "The actions were not saved.") });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={cardClass}>
      <div className="border-b border-border px-lg py-md">
        <p className={labelClass}>{title}</p>
        <p className="mt-xs font-mono text-body-sm text-muted">
          {n(results.length)} contacts
          {reused > 0 ? ` · ${n(reused)} reused from earlier checks` : ""}
          {stats ? ` · ${formatUsd(stats.usd)} · ${n(stats.searches)} searches · ${n(stats.hunter)} Hunter credits` : ""}
          {stats && stats.ms > 0 ? ` · ${formatDuration(stats.ms)}` : ""}
        </p>
        <div className="mt-sm">
          <StatusCounts results={results} />
        </div>
        {unchecked > 0 ? (
          <p className="mt-sm text-body-sm text-error">
            {n(unchecked)} contact{unchecked === 1 ? " was" : "s were"} not checked because a step failed. Start a new run to check
            {unchecked === 1 ? " it" : " them"}; everything else is reused.
          </p>
        ) : null}
      </div>

      {problems.length === 0 ? (
        <p className="px-lg py-md text-body-sm text-success">Every checked contact is Clean. Nothing to do.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-sm px-lg py-md">
            <h2 className="text-h4 text-heading">
              Action required · {n(problems.length)} contact{problems.length === 1 ? "" : "s"}
            </h2>
            <button type="button" className={primaryButton} disabled={pending || selected.length === 0} onClick={() => void apply()}>
              {pending ? "Saving…" : `Apply ${n(selected.length)} action${selected.length === 1 ? "" : "s"}`}
            </button>
          </div>
          {notice ? (
            <p
              role={notice.kind === "error" ? "alert" : "status"}
              className={`mx-lg mb-md rounded-md border px-md py-sm text-body-sm ${notice.kind === "error" ? "border-error/40 text-error" : "border-success/40 text-success"}`}
            >
              {notice.text}
            </p>
          ) : null}
          <ul className="border-t border-border">
            {problems.slice(0, shown).map((result) => {
              const draft = draftOf(result);
              const done = doneLabel(result);
              const name = result.contact.name;
              return (
                <li key={result.contact.id} className={`grid gap-sm border-b border-border px-lg py-md lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] ${done && !draft.include ? "opacity-60" : ""}`}>
                  <div className="min-w-0 text-body-sm">
                    <label className="flex items-start gap-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={draft.include}
                        onChange={(event) => update(result, { include: event.target.checked })}
                        aria-label={`Include ${name}`}
                      />
                      <span className="min-w-0">
                        <span className="text-heading">{name}</span>{" "}
                        <StatusBadge state={result.status!} />
                        {result.reused ? <span className="ml-xs text-muted">(earlier check)</span> : null}
                        <span className="block truncate text-muted">
                          {result.contact.title || "No title"} · {result.contact.firmName} · {result.contact.email}
                        </span>
                        <span className="block text-secondary">
                          {reasonOf(result)} <EvidenceLinks items={evidenceOf(result.steps)} />
                        </span>
                        {done ? <span className="block text-success">✓ {done}</span> : null}
                      </span>
                    </label>
                  </div>
                  <div className="space-y-xs">
                    <div className="flex flex-wrap gap-xs" role="radiogroup" aria-label={`Action for ${name}`}>
                      {ACTIONS.map((action) => (
                        <button
                          key={action}
                          type="button"
                          role="radio"
                          aria-checked={draft.action === action}
                          className={
                            draft.action === action
                              ? "rounded-md bg-primary px-sm py-xs text-body-sm text-white"
                              : smallButton
                          }
                          onClick={() =>
                            update(result, {
                              action,
                              include: true,
                              title:
                                action === "update_firm"
                                  ? result.suggestion?.title ?? ""
                                  : action === "update_name"
                                    ? result.contact.title
                                    : draft.title,
                            })
                          }
                        >
                          {ACTION_LABEL[action]}
                          {result.suggestion?.action === action ? " ★" : ""}
                        </button>
                      ))}
                    </div>
                    <Fields draft={draft} name={name} onChange={(patch) => update(result, patch)} />
                    <p className="text-body-sm text-muted">{HELP[draft.action]}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="px-lg py-sm text-body-sm text-muted">★ suggested</p>
          {problems.length > shown ? (
            <div className="border-t border-border px-lg py-md">
              <button type="button" className={smallButton} onClick={() => setShown((value) => value + PAGE)}>
                Show more ({n(problems.length - shown)} left)
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
