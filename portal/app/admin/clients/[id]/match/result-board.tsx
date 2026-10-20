"use client";

import { useState } from "react";
import Link from "next/link";
import { restoreHiddenFund } from "@/app/admin/match-actions";
import { FirmDrawer } from "@/app/admin/clients/[id]/match/firm-drawer";
import { LeadsTable, type SplitFilter } from "@/app/admin/clients/[id]/match/leads-table";
import {
  cardClass,
  errorText,
  inputClass,
  labelClass,
  n,
  primaryButton,
  secondaryButton,
  smallButton,
  type Notice,
} from "@/app/admin/clients/[id]/match/ui";
import {
  DEFAULT_SETTINGS,
  LEVEL_LABEL,
  LEVEL_MAX,
  LEVEL_MIN,
  SITE_N_OPTIONS,
  TIERS,
  type Count,
  type Level,
  type MatchSettings,
  type MatchView,
  type Tier,
  type TierSummary,
} from "@/lib/match/shared";

type Tab = Tier | "reply";

const TIER_TONE: Record<Tier, string> = {
  bullseye: "border-primary/40 bg-primary-tint",
  match: "border-border bg-background",
  expansion: "border-border bg-surface",
};

function Bars({
  items,
  onPick,
  active,
}: {
  items: Count[];
  onPick?: (label: string) => void;
  active?: string | null;
}) {
  const max = Math.max(1, ...items.map((item) => item.count));
  if (items.length === 0) return <p className="text-body-sm text-muted">None.</p>;
  return (
    <ul className="space-y-xs">
      {items.map((item) => {
        const body = (
          <>
            <span className="flex justify-between gap-sm text-body-sm">
              <span className={active === item.label ? "text-primary" : "text-body"}>{item.label}</span>
              <span className="font-mono text-muted">{n(item.count)}</span>
            </span>
            <span className="mt-px block h-1.5 rounded-full bg-border">
              <span
                className="block h-1.5 rounded-full bg-primary"
                style={{ width: `${Math.round((item.count / max) * 100)}%` }}
              />
            </span>
          </>
        );
        return (
          <li key={item.label}>
            {onPick && item.label !== "Other" ? (
              <button
                type="button"
                className="block w-full text-left"
                aria-pressed={active === item.label}
                onClick={() => onPick(item.label)}
              >
                {body}
              </button>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Splits({
  summary,
  split,
  onSplit,
}: {
  summary: TierSummary;
  split: SplitFilter;
  onSplit: (next: SplitFilter) => void;
}) {
  const reviewed = summary.audit.approved + summary.audit.rejected;
  return (
    <div className="grid gap-lg border-b border-border px-lg py-md lg:grid-cols-3">
      <div>
        <p className={`${labelClass} mb-sm`}>By fund type</p>
        <Bars
          items={summary.byType}
          active={split?.kind === "type" ? split.value : null}
          onPick={(value) =>
            onSplit(split?.kind === "type" && split.value === value ? null : { kind: "type", value })
          }
        />
      </div>
      <div>
        <p className={`${labelClass} mb-sm`}>By fund HQ</p>
        <Bars
          items={summary.byHq}
          active={split?.kind === "loc" ? split.value : null}
          onPick={(value) =>
            onSplit(split?.kind === "loc" && split.value === value ? null : { kind: "loc", value })
          }
        />
      </div>
      <div className="space-y-md">
        <div>
          <p className={`${labelClass} mb-sm`}>Fit</p>
          <p className="text-body-sm text-secondary">
            {summary.fitBands.map((band) => `${band.label}: ${n(band.count)}`).join(" · ")}
          </p>
        </div>
        <div>
          <p className={`${labelClass} mb-sm`}>Data confidence</p>
          <p className="text-body-sm text-secondary">
            {summary.confBands.map((band) => `${band.label}: ${n(band.count)}`).join(" · ")}
          </p>
        </div>
        <div>
          <p className={`${labelClass} mb-sm`}>Website check</p>
          <p className="text-body-sm text-secondary">
            {summary.siteStats.length > 0
              ? summary.siteStats.map((item) => `${item.label}: ${n(item.count)}`).join(" · ")
              : "Off for this client."}
          </p>
          {summary.deadRemoved.length > 0 ? (
            <details className="mt-xs text-body-sm">
              <summary className="cursor-pointer text-warning">
                {n(summary.deadRemoved.length)} dropped for dead websites
              </summary>
              <ul className="mt-xs space-y-px text-muted">
                {summary.deadRemoved.map((item) => (
                  <li key={item.id}>
                    {item.name}
                    {item.why ? `: ${item.why}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
        <div>
          <p className={`${labelClass} mb-sm`}>Review</p>
          <p className="text-body-sm text-secondary">
            {reviewed === 0
              ? "No reviews yet."
              : `${n(summary.audit.approved)} approved · ${n(summary.audit.rejected)} rejected (${Math.round((summary.audit.approved / reviewed) * 100)}% approval) of ${n(summary.audit.total)}`}
          </p>
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({
  settings,
  busy,
  hidden,
  onApply,
  onRestore,
}: {
  settings: MatchSettings;
  busy: boolean;
  hidden: MatchView["hidden"];
  onApply: (next: MatchSettings) => void;
  onRestore: (firmId: string) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const filters = draft.filters;
  const setFilter = (patch: Partial<MatchSettings["filters"]>) =>
    setDraft((current) => ({ ...current, filters: { ...current.filters, ...patch } }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  return (
    <details className={`${cardClass} px-lg py-md`}>
      <summary className="cursor-pointer text-label uppercase tracking-label text-secondary">
        Quality filters & rules
      </summary>
      <div className="mt-md grid gap-md md:grid-cols-2">
        <div className="space-y-sm text-body-sm">
          <label className="flex items-start gap-sm">
            <input
              type="checkbox"
              checked={filters.noPlatforms}
              onChange={(event) => setFilter({ noPlatforms: event.target.checked })}
            />
            Drop multi-stage platforms (8+ stages)
          </label>
          <label className="flex items-start gap-sm">
            <input
              type="checkbox"
              checked={filters.needDecision}
              onChange={(event) => setFilter({ needDecision: event.target.checked })}
            />
            Require a decision maker or deal champion with an email
          </label>
          <label className="flex items-start gap-sm">
            <input
              type="checkbox"
              checked={filters.needEmail}
              onChange={(event) => setFilter({ needEmail: event.target.checked })}
            />
            Only funds with an investing contact who has an email
          </label>
          <label className="flex items-start gap-sm">
            <input
              type="checkbox"
              checked={filters.nearOnly}
              onChange={(event) => setFilter({ nearOnly: event.target.checked })}
            />
            Team near the client only
          </label>
          <label className="flex items-start gap-sm">
            <input
              type="checkbox"
              checked={draft.dropDead}
              onChange={(event) => setDraft((current) => ({ ...current, dropDead: event.target.checked }))}
            />
            Drop funds whose website is dead, parked or not investing
          </label>
        </div>
        <div className="grid gap-sm sm:grid-cols-2">
          <label className="text-body-sm">
            <span className={labelClass}>Minimum data confidence</span>
            <select
              className={`${inputClass} mt-xs`}
              value={filters.minConf}
              onChange={(event) =>
                setFilter({ minConf: Number(event.target.value) as MatchSettings["filters"]["minConf"] })
              }
            >
              <option value={0}>Any</option>
              <option value={0.6}>Medium or high</option>
              <option value={0.99}>High only</option>
            </select>
          </label>
          <label className="text-body-sm">
            <span className={labelClass}>Founded in or after</span>
            <input
              type="number"
              min={1900}
              max={2100}
              placeholder="Any year"
              className={`${inputClass} mt-xs`}
              value={filters.foundedAfter || ""}
              onChange={(event) => setFilter({ foundedAfter: Number(event.target.value) || 0 })}
            />
          </label>
          <label className="text-body-sm">
            <span className={labelClass}>First-wave size (Bullseye cap)</span>
            <input
              type="number"
              min={10}
              max={1000}
              className={`${inputClass} mt-xs`}
              value={draft.waveSize}
              onChange={(event) =>
                setDraft((current) => ({ ...current, waveSize: Number(event.target.value) || 0 }))
              }
            />
          </label>
          <label className="text-body-sm">
            <span className={labelClass}>Websites checked per tier</span>
            <select
              className={`${inputClass} mt-xs`}
              value={draft.siteN}
              onChange={(event) =>
                setDraft((current) => ({ ...current, siteN: Number(event.target.value) as MatchSettings["siteN"] }))
              }
            >
              {SITE_N_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === 0 ? "Off" : `Top ${option}`}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="mt-md flex flex-wrap gap-sm">
        <button type="button" className={primaryButton} disabled={busy || !dirty} onClick={() => onApply(draft)}>
          Apply
        </button>
        <button
          type="button"
          className={secondaryButton}
          disabled={busy}
          onClick={() => {
            const next = { ...DEFAULT_SETTINGS, tune: settings.tune };
            setDraft(next);
            onApply(next);
          }}
        >
          Reset to default
        </button>
      </div>
      <div className="mt-lg">
        <p className={`${labelClass} mb-xs`}>Hidden for all clients</p>
        {hidden.length === 0 ? (
          <p className="text-body-sm text-muted">
            None. Rejecting a fund with &ldquo;Hide this fund for all clients&rdquo; puts it here.
          </p>
        ) : (
          <ul className="max-h-48 space-y-xs overflow-auto text-body-sm">
            {hidden.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-sm">
                <span>
                  <span className="text-heading">{item.name || item.id}</span>
                  {item.reason ? <span className="text-muted"> · {item.reason}</span> : null}
                </span>
                <button type="button" className={smallButton} disabled={busy} onClick={() => onRestore(item.id)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

export function ResultBoard({
  clientId,
  view,
  settings,
  busy,
  onSettings,
  onView,
  onNotice,
  onCheckWebsites,
  onSendToClient,
  sendBlocked,
}: {
  clientId: string;
  view: MatchView;
  settings: MatchSettings;
  busy: boolean;
  onSettings: (next: MatchSettings, toast?: (after: MatchView) => string) => void;
  onView: (view: MatchView) => void;
  onNotice: (notice: Notice | null) => void;
  onCheckWebsites: () => void;
  onSendToClient: () => void;
  /** Why Send to client is not available yet, or null when it is. */
  sendBlocked: string | null;
}) {
  const [tab, setTab] = useState<Tab>("bullseye");
  const [split, setSplit] = useState<SplitFilter>(null);
  const [openFirm, setOpenFirm] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inTier = view.counts.bullseye + view.counts.match + view.counts.expansion;
  const funnelMax = Math.max(1, view.funnel[0]?.count ?? 1);

  function step(tier: Tier, delta: 1 | -1) {
    const level = settings.tune[tier];
    const nextLevel = Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, level + delta)) as Level;
    if (nextLevel === level) return;
    const label = TIERS.find((item) => item.key === tier)?.label ?? tier;
    const before = tier === "bullseye" ? view.qualifiedBullseye : view.counts[tier];
    onSettings({ ...settings, tune: { ...settings.tune, [tier]: nextLevel } }, (after) => {
      const now = tier === "bullseye" ? after.qualifiedBullseye : after.counts[tier];
      return `${label}${tier === "bullseye" ? "-qualified" : ""} ${n(before)} → ${n(now)} (${LEVEL_LABEL[nextLevel]}). Match ${n(view.counts.match)} → ${n(after.counts.match)}, Expansion ${n(view.counts.expansion)} → ${n(after.counts.expansion)}.`;
    });
  }

  async function restore(firmId: string) {
    onNotice(null);
    try {
      const result = await restoreHiddenFund(clientId, firmId);
      if (!result.ok) onNotice({ kind: "error", text: result.error });
      else onView(result.view);
    } catch (err) {
      onNotice({ kind: "error", text: errorText(err, "Unable to restore.") });
    }
  }

  async function copyReply() {
    try {
      await navigator.clipboard.writeText(view.reply);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      onNotice({ kind: "error", text: "Copy failed. Select the text and copy it instead." });
    }
  }

  const tabClass = (active: boolean) =>
    `rounded-md px-md py-sm text-body-sm transition-colors duration-hover ${
      active ? "bg-primary text-white" : "border border-border bg-surface text-secondary hover:text-heading"
    }`;
  const tierSummary = tab === "reply" ? null : view.tiers[tab];

  return (
    <div className="space-y-lg">
      <section className={`${cardClass} px-lg py-md`}>
        <div className="flex flex-wrap items-start justify-between gap-md">
          <div className="min-w-0">
            <p className={labelClass}>Match result</p>
            <h2 className="mt-xs text-h3 text-heading">{view.header}</h2>
            <p className="mt-xs font-mono text-body-sm text-muted">
              {n(inTier)} funds · {n(view.people)} investing contacts
            </p>
          </div>
          <div className="flex flex-wrap gap-sm">
            <button type="button" className={secondaryButton} disabled={busy} onClick={onCheckWebsites}>
              Check websites
            </button>
            <Link href={`/admin/clients/${clientId}/match/verify`} className={`${secondaryButton} no-underline`}>
              Verify emails
            </Link>
            <a
              href={`/admin/clients/${clientId}/match/export`}
              className={`${secondaryButton} no-underline`}
              title="Internal workbook without contacts that have a known problem (Email bad, Left firm, Role changed, Not found) unless kept"
            >
              Export (no known problems)
            </a>
            <a
              href={`/admin/clients/${clientId}/match/export?all=1`}
              className={`${secondaryButton} no-underline`}
              title="Internal workbook with every contact, verified or not"
            >
              Export everything
            </a>
            <button
              type="button"
              className={primaryButton}
              disabled={busy || inTier === 0 || Boolean(sendBlocked)}
              title={sendBlocked ?? undefined}
              onClick={onSendToClient}
            >
              Send to client
            </button>
          </div>
        </div>
        {sendBlocked ? (
          <p className="mt-sm text-body-sm text-muted">{sendBlocked}</p>
        ) : null}

        <div className="mt-md grid gap-sm md:grid-cols-3">
          {TIERS.map((tier) => {
            const level = settings.tune[tier.key];
            return (
              <div key={tier.key} className={`rounded-card border px-md py-md ${TIER_TONE[tier.key]}`}>
                <p className="text-label uppercase tracking-label text-primary">{tier.label}</p>
                <p className="mt-xs font-mono text-h2 text-heading">{n(view.counts[tier.key])}</p>
                {tier.key === "bullseye" && view.qualifiedBullseye > view.wave ? (
                  <p className="text-body-sm text-heading">
                    wave 1 of {n(view.qualifiedBullseye)} qualified
                  </p>
                ) : null}
                <p className="mt-xs text-body-sm text-secondary">{tier.description}</p>
                <div className="mt-sm flex items-center gap-sm">
                  <button
                    type="button"
                    className={smallButton}
                    aria-label={`Broaden ${tier.label}`}
                    disabled={busy || level <= LEVEL_MIN}
                    onClick={() => step(tier.key, -1)}
                  >
                    −
                  </button>
                  <span className="min-w-[5rem] text-center text-body-sm text-heading">{LEVEL_LABEL[level]}</span>
                  <button
                    type="button"
                    className={smallButton}
                    aria-label={`Tighten ${tier.label}`}
                    disabled={busy || level >= LEVEL_MAX}
                    onClick={() => step(tier.key, 1)}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {view.qualifiedBullseye > view.wave ? (
          <p className="mt-sm rounded-md bg-background px-md py-sm text-body-sm text-secondary">
            {n(view.qualifiedBullseye)} funds qualify as Bullseye. The top {n(view.wave)} are wave 1; the
            other {n(view.qualifiedBullseye - view.wave)} lead the Match list as wave 2. Tighten Bullseye or
            change the wave size under Quality filters & rules.
          </p>
        ) : null}
        {view.fewBullseye ? (
          <p className="mt-sm rounded-md bg-background px-md py-sm text-body-sm text-secondary">
            Few Bullseye funds. Consider a second vertical, broadening Bullseye, or adding the markets
            the company sells into.
          </p>
        ) : null}
      </section>

      <SettingsPanel
        key={JSON.stringify(settings)}
        settings={settings}
        busy={busy}
        hidden={view.hidden}
        onApply={(next) => onSettings(next)}
        onRestore={(firmId) => void restore(firmId)}
      />

      <section className={`${cardClass} px-lg py-md`}>
        <p className={`${labelClass} mb-sm`}>How the database narrows</p>
        <ul className="space-y-xs">
          {view.funnel.map((item) => (
            <li key={item.label} className="grid grid-cols-[minmax(0,14rem)_1fr_auto] items-center gap-sm text-body-sm">
              <span className="truncate text-body">{item.label}</span>
              <span className="block h-1.5 rounded-full bg-border">
                <span
                  className="block h-1.5 rounded-full bg-primary"
                  style={{ width: `${Math.round((item.count / funnelMax) * 100)}%` }}
                />
              </span>
              <span className="font-mono text-muted">{n(item.count)}</span>
            </li>
          ))}
        </ul>
        {view.funnelNotes.length > 0 ? (
          <p className="mt-sm text-body-sm text-muted">Not counted: {view.funnelNotes.join(" · ")}.</p>
        ) : null}
      </section>

      <section className={cardClass}>
        <div className="flex flex-wrap gap-sm border-b border-border px-lg py-md" role="tablist" aria-label="Results">
          {TIERS.map((tier) => (
            <button
              key={tier.key}
              type="button"
              role="tab"
              aria-selected={tab === tier.key}
              className={tabClass(tab === tier.key)}
              onClick={() => {
                setTab(tier.key);
                setSplit(null);
              }}
            >
              {tier.label} · {n(view.counts[tier.key])}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={tab === "reply"}
            className={tabClass(tab === "reply")}
            onClick={() => setTab("reply")}
          >
            Match-count reply
          </button>
        </div>

        {tierSummary ? (
          <>
            <div className="flex flex-wrap items-center gap-xs border-b border-border px-lg py-sm">
              <span className={`${labelClass} mr-xs`}>
                Rules · {LEVEL_LABEL[tierSummary.level]}
              </span>
              {tierSummary.rules.map((rule) => (
                <span key={rule} className="rounded-full bg-background px-sm py-px text-body-sm text-secondary">
                  {rule}
                </span>
              ))}
            </div>
            <Splits summary={tierSummary} split={split} onSplit={setSplit} />
            <LeadsTable
              key={tierSummary.key}
              rows={view.rows.filter((row) => row.tier === tierSummary.key)}
              split={split}
              onClearSplit={() => setSplit(null)}
              onOpen={setOpenFirm}
            />
          </>
        ) : (
          <div className="px-lg py-md">
            <p className="text-body-sm text-muted">
              For a prospect who asked how many funds fit. Counts only; it never claims check-size fit.
            </p>
            <textarea readOnly rows={5} className={`${inputClass} mt-sm`} value={view.reply} aria-label="Match-count reply" />
            <button type="button" className={`${secondaryButton} mt-sm`} onClick={() => void copyReply()}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
      </section>

      {openFirm ? (
        <FirmDrawer
          clientId={clientId}
          firmId={openFirm}
          row={view.rows.find((row) => row.id === openFirm) ?? null}
          onClose={() => setOpenFirm(null)}
          onView={onView}
        />
      ) : null}
    </div>
  );
}
