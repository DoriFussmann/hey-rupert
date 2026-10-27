import type { ReactNode } from "react";
import Link from "next/link";
import { cardClass, n } from "@/app/admin/clients/[id]/match/ui";
import { FundReview } from "@/app/admin/clients/[id]/match/four-tier/fund-review";
import { RemoveFromCampaign } from "@/app/admin/matching/remove-from-campaign";
import { SOURCE_LABEL } from "@/lib/match/capacity/allocate";
import { verifyTierPath, type Review } from "@/lib/match/shared";
import { distinctPeople } from "@/lib/match/tiers/client-list";
import { reasonLabel, type StoredResult } from "@/lib/match/tiers/stored";
import {
  NOTE_LABEL,
  TIER_INFO,
  TIER_KEYS,
  type IdentityDetail,
  type NoteCode,
  type PersonRecord,
  type TierKey,
} from "@/lib/match/tiers/core";
import { runFacts, storedCounts } from "@/lib/match/tiers/export";
import type { RunHeader } from "@/lib/match/tiers/server";

/** Funds listed per group on the page; the export has every fund. */
const SHOWN = 150;

export function Alert({ tone, children }: { tone: "error" | "warning"; children: ReactNode }) {
  return (
    <div
      role="alert"
      className={`mb-lg rounded-card border bg-surface px-lg py-md text-body-sm ${tone === "error" ? "border-error/40 text-error" : "border-warning/40 text-warning"}`}
    >
      {children}
    </div>
  );
}

export function Section({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <section className={`${cardClass} mb-lg px-lg py-md`}>
      <h2 className="text-h4 text-heading">
        {title} {meta ? <span className="text-body-sm font-normal text-muted">{meta}</span> : null}
      </h2>
      <div className="mt-sm">{children}</div>
    </section>
  );
}

type Check = { result: string; detail: string };

/** Reviews this client has now, and where to save new ones. Only on the Match page. */
export type ReviewContext = { clientId: string; reviews: Record<string, Review> };

/** The confirmed campaign a fund is in: it can be removed from it. */
export type CampaignContext = { clientId: string; runId: string };

const CHECK_ORDER: [string, string][] = [
  ["firmType", "Firm type"],
  ["financing", "Financing"],
  ["stage", "Stage"],
  ["geography", "Geography"],
  ["sector", "Sector"],
];

/** Everything the run recorded about one fund: each check, the relationship used, identity and contacts. */
function FundDetails({ row, review, campaign }: { row: StoredResult; review?: ReviewContext; campaign?: CampaignContext }) {
  const checks = (row.detail.checks ?? {}) as Record<string, Check>;
  const people = distinctPeople((row.detail.people ?? []) as PersonRecord[]);
  const identity = row.detail.identity as IdentityDetail | undefined;
  const notes = ((row.detail.notes ?? []) as string[]).map((code) => NOTE_LABEL[code as NoteCode] ?? code);
  const sectors = (row.detail.sectorTags ?? []) as string[];
  const baseId = row.firmId.replace(/#\d+$/, "");
  const current = review?.reviews[baseId] ?? null;
  return (
    <div className="mt-xs space-y-xs text-body-sm">
      <dl className="grid gap-x-md gap-y-xs sm:grid-cols-[8rem_1fr]">
        {CHECK_ORDER.filter(([key]) => checks[key]).map(([key, title]) => (
          <div key={key} className="contents">
            <dt className="text-muted">{title}</dt>
            <dd className={checks[key].result === "pass" ? "text-secondary" : "text-warning"}>{checks[key].detail}</dd>
          </div>
        ))}
        <dt className="text-muted">Firm sectors</dt>
        <dd className="text-secondary">{sectors.join(", ") || "–"}</dd>
        {row.detail.site ? (
          <>
            <dt className="text-muted">Website check</dt>
            <dd className="text-secondary">{String(row.detail.site)}</dd>
          </>
        ) : null}
      </dl>
      {notes.length ? <p className="text-warning">{notes.join(" · ")}</p> : null}
      {row.detail.rejected ? <p className="text-warning">Rejected for this client when this run was made: {String(row.detail.rejected)}</p> : null}
      {identity ? (
        <div className="rounded-md border border-border px-sm py-xs">
          <p className="text-heading">
            {identity.kind === "offices" ? "One firm, several offices" : "Duplicate records of one firm"} ·{" "}
            {identity.status === "confirmed" ? `confirmed by ${identity.decidedBy ?? "an admin"}` : "applied automatically"}
          </p>
          <p className="text-muted">{identity.derivation}</p>
          <ul className="mt-xs list-disc pl-lg">
            {identity.members.map((m) => (
              <li key={m.firmId} className="text-secondary">
                {m.firmId} · {m.country || "–"} · {m.contacts} contacts ·{" "}
                {m.status === "tiered" ? TIER_INFO[m.tier as TierKey]?.label : m.status}
                {m.reason ? ` (${reasonLabel(m.reason)})` : ""}
                {m.rejected ? ` · rejected for this client: ${m.rejected}` : ""}
                {m.firmId === row.firmId ? " · shown" : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {people.length ? (
        <ul className="list-disc pl-lg text-secondary">
          {people.slice(0, 8).map((p) => (
            <li key={`${p.fid}-${p.key}-${p.name}`}>
              {p.seq ? `${p.seq}: ` : ""}
              {p.name}, {p.title || p.role}
              {p.fid !== baseId ? ` (record ${p.fid})` : ""}
            </li>
          ))}
          {people.length > 8 ? <li className="text-muted">and {people.length - 8} more in the export</li> : null}
        </ul>
      ) : null}
      {campaign ? (
        <RemoveFromCampaign clientId={campaign.clientId} runId={campaign.runId} firmId={row.firmId} firmName={row.firmName} />
      ) : review && row.status === "tiered" ? (
        <FundReview
          clientId={review.clientId}
          firmId={baseId}
          firmName={row.firmName}
          tier={row.tier ?? ""}
          current={current}
        />
      ) : null}
    </div>
  );
}

/** A small link that opens the fund's website in a new tab. */
function WebsiteLink({ href, name }: { href: string; name: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-background hover:text-primary"
      title={`${name} website`}
    >
      <span className="sr-only">{name} website (opens in a new tab)</span>
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
        <path d="M8 5H5v10h10v-3M11 4h5v5M10 10l6-6" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </a>
  );
}

function FundList({
  rows,
  review,
  campaign,
  websites = {},
}: {
  rows: StoredResult[];
  review?: ReviewContext;
  campaign?: CampaignContext;
  /** Fund website by run row key. */
  websites?: Record<string, string>;
}) {
  if (rows.length === 0) return <p className="text-body-sm text-muted">None.</p>;
  return (
    <>
      <ul className="divide-y divide-border">
        {rows.slice(0, SHOWN).map((row) => {
          const baseId = row.firmId.replace(/#\d+$/, "");
          const now = review?.reviews[baseId];
          return (
            <li key={row.firmId} className="flex items-start gap-xs py-xs">
              <details className="min-w-0 flex-1">
                <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-sm [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 text-body-sm text-heading">
                    {row.firmName} <span className="font-mono text-label text-muted">{row.firmId}</span>
                    {row.detail.identity ? (
                      <span className="ml-xs text-label text-muted">· one of {(row.detail.identity as IdentityDetail).members.length} records</span>
                    ) : null}
                    {row.detail.rejected ? <span className="ml-xs text-label text-warning">· rejected</span> : null}
                    {now && !row.detail.rejected && now.status === "no" ? <span className="ml-xs text-label text-warning">· rejected after this run</span> : null}
                    {now?.status === "ok" ? <span className="ml-xs text-label text-success">· approved</span> : null}
                  </span>
                  <span className="text-body-sm tabular-nums text-muted">
                    {row.score != null ? `Fit ${row.score}` : reasonLabel(row.reasonCodes[row.reasonCodes.length - 1] ?? "")}
                  </span>
                </summary>
                <FundDetails row={row} review={review} campaign={campaign} />
              </details>
              {websites[row.firmId] ? <WebsiteLink href={websites[row.firmId]} name={row.firmName} /> : null}
            </li>
          );
        })}
      </ul>
      {rows.length > SHOWN ? <p className="mt-xs text-body-sm text-muted">Showing {SHOWN} of {n(rows.length)}. The export has every fund.</p> : null}
    </>
  );
}

type RunProps = {
  clientId: string;
  header: RunHeader;
  rows: StoredResult[];
  complete: boolean;
  review?: ReviewContext;
  /** Fund website by run row key. */
  websites?: Record<string, string>;
};

/** Investing contacts of the funds, as the run recorded them. */
function contactCount(rows: StoredResult[]) {
  return rows.reduce((sum, row) => sum + distinctPeople((row.detail.people ?? []) as PersonRecord[]).length, 0);
}

/** Contacts that will be emailed: up to `perFirm` per fund, of those with an email. */
function emailCount(rows: StoredResult[], perFirm: number) {
  return rows.reduce((sum, row) => {
    const reachable = distinctPeople((row.detail.people ?? []) as PersonRecord[]).filter((p) => p.email?.trim()).length;
    return sum + Math.min(reachable, perFirm);
  }, 0);
}

/** The Verify Emails tab's tier for a panel: approved generalists are checked with Tier 4. */
function verifyTier(key: string) {
  return key === "generalist" ? "tier4" : key;
}

/**
 * One tier as a panel on its own row, collapsed: the name, the funds and
 * contacts in it, and (with a client) a link to verify only its funds.
 */
function TierPanel({
  label,
  description,
  funds,
  contacts,
  toEmail,
  verifyHref,
  children,
}: {
  label: string;
  description: string;
  funds: number;
  /** Investing contacts on file. */
  contacts: number;
  /** Contacts that will be emailed, when a campaign plan sets contacts per firm. */
  toEmail?: number;
  verifyHref?: string;
  children: ReactNode;
}) {
  return (
    <details className={`${cardClass} group/tier mb-sm`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-md px-lg py-md [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-1 items-center gap-sm">
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="h-4 w-4 shrink-0 text-muted transition-transform group-open/tier:rotate-90 motion-reduce:transition-none"
            fill="none"
          >
            <path d="m8 5 5 5-5 5" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span className="min-w-0 truncate" title={description}>
            <span className="text-h4 text-heading">{label}</span>{" "}
            <span className="text-body-sm text-muted">{description}</span>
          </span>
        </span>
        <span className="shrink-0 whitespace-nowrap text-body-sm tabular-nums text-heading">
          {n(funds)} fund{funds === 1 ? "" : "s"} ·{" "}
          {toEmail !== undefined ? (
            <>
              {n(toEmail)} to email <span className="text-muted">· {n(contacts)} on file</span>
            </>
          ) : (
            <>
              {n(contacts)} contact{contacts === 1 ? "" : "s"} <span className="text-muted">on file</span>
            </>
          )}
        </span>
      </summary>
      <div className="border-t border-border px-lg py-md">
        {verifyHref && funds > 0 ? (
          <p className="mb-sm">
            <Link href={verifyHref} className="text-body-sm text-primary hover:text-primary-hover">
              Verify these funds
            </Link>
          </p>
        ) : null}
        {children}
      </div>
    </details>
  );
}

const listed = (rows: StoredResult[], tier: TierKey) => rows.filter((r) => r.status === "tiered" && r.tier === tier && !r.detail.representedBy);
const outside = (rows: StoredResult[], status: "generalist" | "unresolved" | "excluded") =>
  rows.filter((r) => r.status === status && !r.detail.representedBy);
const nearMissCount = (rows: StoredResult[]) => rows.filter((r) => r.reasonCodes[r.reasonCodes.length - 1] === "stage_one_off").length;
const base = (clientId: string) => `/admin/clients/${clientId}/match/four-tier`;

/** The run's facts, its downloads, its warnings and the counts per tier. */
export function RunSummary({ clientId, header, rows, complete, footnote, title = "Counts" }: RunProps & { footnote?: ReactNode; title?: string }) {
  const counts = storedCounts(rows);
  const facts = runFacts(header, complete);
  const warnings = Array.isArray(header.profileInputs.warnings) ? (header.profileInputs.warnings as string[]) : [];
  return (
    <>
      {!complete ? <Alert tone="error">This run is incomplete: not every result was saved. Run it again.</Alert> : null}
      {warnings.length ? (
        <Alert tone="warning">
          <p className="text-heading">Limited profile: these points are unconfirmed or unresolved.</p>
          <ul className="mt-xs list-disc pl-lg">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <Section title={title}>
        <div className="grid gap-sm text-body-sm sm:grid-cols-2 lg:grid-cols-4">
          {TIER_KEYS.map((key) => (
            <div key={key} className="rounded-md border border-border px-sm py-xs">
              <p className="text-heading">{TIER_INFO[key].label}</p>
              <p className="text-h3 tabular-nums text-heading">{n(counts.tiers[key])}</p>
              <p className="text-label text-muted">{TIER_INFO[key].description}</p>
            </div>
          ))}
        </div>
        <p className="mt-sm text-body-sm text-secondary">
          Rejected for this client {n(counts.rejected)} · Generalists {n(counts.generalists)} · Unresolved {n(counts.unresolved)} · Excluded{" "}
          {n(counts.excluded)} · Shown through another record {n(counts.represented)} · {n(counts.total)} funds in all
        </p>
        <div className="mt-sm flex flex-wrap gap-md text-body-sm">
          <a href={`${base(clientId)}/export?run=${header.id}`} className="text-secondary underline hover:text-heading">
            Export this run (.xlsx)
          </a>
          <a href={`${base(clientId)}/export?run=${header.id}&all=1`} className="text-secondary underline hover:text-heading">
            Export everything, including contacts with known problems
          </a>
        </div>
        <details className="mt-sm">
          <summary className="cursor-pointer text-body-sm text-secondary hover:text-heading">Run details</summary>
          <dl className="mt-xs grid gap-x-lg gap-y-xs text-body-sm sm:grid-cols-[14rem_1fr]">
            {facts.map(([term, value], i) => (
              <div key={`${term}-${i}`} className="contents">
                <dt className="text-muted">{term}</dt>
                <dd className="break-words text-secondary">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </details>
        {footnote ? <div className="mt-sm text-body-sm text-muted">{footnote}</div> : null}
      </Section>
    </>
  );
}

/** The four tiers, one collapsed panel per row. */
export function TierColumns({ rows, review, websites }: Pick<RunProps, "rows" | "review" | "websites">) {
  return (
    <div className="mb-lg">
      {TIER_KEYS.map((key) => {
        const funds = listed(rows, key);
        return (
          <TierPanel
            key={key}
            label={TIER_INFO[key].label}
            description={TIER_INFO[key].description}
            funds={funds.length}
            contacts={contactCount(funds)}
            verifyHref={review ? verifyTierPath(review.clientId, key) : undefined}
          >
            <FundList rows={funds} review={review} websites={websites} />
          </TierPanel>
        );
      })}
    </div>
  );
}

/**
 * The confirmed campaign, tier by tier, one collapsed panel per row: the
 * plan's funds (each can be removed from the campaign), then the tier's other
 * funds, collapsed. Approved generalists get their own panel, never a tier's.
 */
export function CampaignColumns({
  rows,
  planned,
  review,
  campaign,
  heading,
  websites,
  perFirm = 2,
}: {
  /** Contacts emailed per fund, from the campaign plan. */
  perFirm?: number;
  rows: StoredResult[];
  /** The plan's run row keys. */
  planned: Set<string>;
  review: ReviewContext;
  campaign: CampaignContext;
  /** Shown above the panels: which plan this is. */
  heading?: ReactNode;
  /** Fund website by run row key. */
  websites?: Record<string, string>;
}) {
  const generalists = rows.filter((r) => r.status === "generalist" && planned.has(r.firmId));
  const panels = [
    ...TIER_KEYS.map((key) => ({
      key: key as string,
      label: TIER_INFO[key].label,
      description: TIER_INFO[key].description,
      inPlan: listed(rows, key).filter((r) => planned.has(r.firmId)),
      others: listed(rows, key).filter((r) => !planned.has(r.firmId)),
    })),
    ...(generalists.length > 0
      ? [{ key: "generalist", label: SOURCE_LABEL.generalist, description: "Broad investors, approved for this campaign. Never shown as a tier.", inPlan: generalists, others: [] }]
      : []),
  ];
  return (
    <>
      {heading ? <div className="mb-sm">{heading}</div> : null}
      <div className="mb-lg">
        {panels.map((panel) => (
          <TierPanel
            key={panel.key}
            label={panel.label}
            description={panel.description}
            funds={panel.inPlan.length}
            contacts={contactCount(panel.inPlan)}
            toEmail={emailCount(panel.inPlan, perFirm)}
            verifyHref={verifyTierPath(campaign.clientId, verifyTier(panel.key))}
          >
            <FundList rows={panel.inPlan} campaign={campaign} websites={websites} />
            {panel.others.length > 0 ? (
              <details className="mt-sm border-t border-border pt-sm">
                <summary className="cursor-pointer text-body-sm text-secondary hover:text-heading">Not in this campaign ({n(panel.others.length)})</summary>
                <div className="mt-xs">
                  <FundList rows={panel.others} review={review} websites={websites} />
                </div>
              </details>
            ) : null}
          </TierPanel>
        ))}
      </div>
    </>
  );
}

/** Generalists, unresolved and excluded funds, with the reasons. Admin only; generalists reach the founder only when a campaign plan approves them. */
export function OutsideSection({ rows }: Pick<RunProps, "rows">) {
  const counts = storedCounts(rows);
  return (
    <Section title="Outside the tiers" meta="admin only; generalists go out only when a campaign plan approves them">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] text-left text-body-sm">
          <tbody>
            {Object.entries(counts.reasons)
              .sort((a, b) => b[1] - a[1])
              .map(([code, count]) => (
                <tr key={code} className="border-b border-border">
                  <td className="py-xs pr-md text-heading">{reasonLabel(code)}</td>
                  <td className="py-xs text-right tabular-nums text-secondary">{n(count)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {(["generalist", "unresolved", "excluded"] as const).map((status) => (
        <details key={status} className="mt-sm">
          <summary className="cursor-pointer text-body-sm text-secondary hover:text-heading">
            {status === "generalist" ? "Generalists" : status === "unresolved" ? "Unresolved" : "Excluded"} ({n(outside(rows, status).length)})
          </summary>
          <FundList rows={outside(rows, status)} />
        </details>
      ))}
      <p className="mt-sm text-body-sm text-muted">Every fund and its reason is in the export.</p>
    </Section>
  );
}

/** One stage off: not eligible, never sent. */
export function NearMissSection({ clientId, header, rows }: Pick<RunProps, "clientId" | "header" | "rows">) {
  const nearMisses = nearMissCount(rows);
  return (
    <Section title="Near misses: one stage off" meta={`${n(nearMisses)} · NOT eligible`}>
      <p className="text-body-sm text-secondary">
        Funds that list a stage next to the company&apos;s but not its own. They failed the stage check and are outside every tier. The download is marked NOT
        AN ELIGIBLE MATCH LIST and can&apos;t be pushed to the founder.
      </p>
      {nearMisses > 0 ? (
        <p className="mt-xs text-body-sm">
          <a href={`${base(clientId)}/near-miss?run=${header.id}`} className="text-secondary underline hover:text-heading">
            Download near misses (NOT eligible, .xlsx)
          </a>
        </p>
      ) : null}
    </Section>
  );
}

/** A whole saved run, stacked: for looking back at an earlier run. */
export function FourTierRunView(props: RunProps & { footnote?: ReactNode }) {
  return (
    <>
      <RunSummary {...props} />
      {TIER_KEYS.map((key) => {
        const funds = listed(props.rows, key);
        return (
          <TierPanel
            key={key}
            label={TIER_INFO[key].label}
            description={TIER_INFO[key].description}
            funds={funds.length}
            contacts={contactCount(funds)}
          >
            <FundList rows={funds} review={props.review} websites={props.websites} />
          </TierPanel>
        );
      })}
      <OutsideSection rows={props.rows} />
      <NearMissSection {...props} />
    </>
  );
}
