import type { ReactNode } from "react";
import { cardClass, n } from "@/app/admin/clients/[id]/match/ui";
import { FundReview } from "@/app/admin/clients/[id]/match/four-tier/fund-review";
import { RemoveFromCampaign } from "@/app/admin/matching/remove-from-campaign";
import { SOURCE_LABEL } from "@/lib/match/capacity/allocate";
import type { Review } from "@/lib/match/shared";
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
function FundDetails({ row, narrow, review, campaign }: { row: StoredResult; narrow: boolean; review?: ReviewContext; campaign?: CampaignContext }) {
  const checks = (row.detail.checks ?? {}) as Record<string, Check>;
  const people = distinctPeople((row.detail.people ?? []) as PersonRecord[]);
  const identity = row.detail.identity as IdentityDetail | undefined;
  const notes = ((row.detail.notes ?? []) as string[]).map((code) => NOTE_LABEL[code as NoteCode] ?? code);
  const sectors = (row.detail.sectorTags ?? []) as string[];
  const baseId = row.firmId.replace(/#\d+$/, "");
  const current = review?.reviews[baseId] ?? null;
  return (
    <div className="mt-xs space-y-xs text-body-sm">
      <dl className={`grid gap-x-md gap-y-xs ${narrow ? "" : "sm:grid-cols-[8rem_1fr]"}`}>
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

function FundList({
  rows,
  narrow = false,
  review,
  campaign,
}: {
  rows: StoredResult[];
  narrow?: boolean;
  review?: ReviewContext;
  campaign?: CampaignContext;
}) {
  if (rows.length === 0) return <p className="text-body-sm text-muted">None.</p>;
  return (
    <>
      <ul className="divide-y divide-border">
        {rows.slice(0, SHOWN).map((row) => {
          const baseId = row.firmId.replace(/#\d+$/, "");
          const now = review?.reviews[baseId];
          return (
            <li key={row.firmId} className="py-xs">
              <details>
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
                <FundDetails row={row} narrow={narrow} review={review} campaign={campaign} />
              </details>
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
};

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

/** The four tiers side by side; stacked on smaller screens. */
export function TierColumns({ rows, review }: Pick<RunProps, "rows" | "review">) {
  return (
    <div className="mb-lg grid gap-md lg:grid-cols-2 2xl:grid-cols-4">
      {TIER_KEYS.map((key) => (
        <section key={key} className={`${cardClass} min-w-0 px-md py-md`} aria-label={`${TIER_INFO[key].label} funds`}>
          <h2 className="text-h4 text-heading">
            {TIER_INFO[key].label} <span className="text-body-sm font-normal text-muted">{n(listed(rows, key).length)}</span>
          </h2>
          <p className="mt-xs text-body-sm text-muted">{TIER_INFO[key].description}</p>
          <div className="mt-sm">
            <FundList rows={listed(rows, key)} narrow review={review} />
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * The confirmed campaign, tier by tier: the plan's funds (each can be removed
 * from the campaign), then the tier's other funds, collapsed. Approved
 * generalists get their own column, never a tier's.
 */
export function CampaignColumns({
  rows,
  planned,
  review,
  campaign,
  heading,
}: {
  rows: StoredResult[];
  /** The plan's run row keys. */
  planned: Set<string>;
  review: ReviewContext;
  campaign: CampaignContext;
  /** Shown above the columns: which plan this is. */
  heading?: ReactNode;
}) {
  const generalists = rows.filter((r) => r.status === "generalist" && planned.has(r.firmId));
  const columns = [
    ...TIER_KEYS.map((key) => ({
      key,
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
      <div className={`mb-lg grid gap-md lg:grid-cols-2 ${columns.length > 4 ? "2xl:grid-cols-5" : "2xl:grid-cols-4"}`}>
        {columns.map((column) => (
          <section key={column.key} className={`${cardClass} min-w-0 px-md py-md`} aria-label={`${column.label} funds in the campaign`}>
            <h2 className="text-h4 text-heading">
              {column.label} <span className="text-body-sm font-normal text-muted">{n(column.inPlan.length)} in the campaign</span>
            </h2>
            <p className="mt-xs text-body-sm text-muted">{column.description}</p>
            <div className="mt-sm">
              <FundList rows={column.inPlan} narrow campaign={campaign} />
            </div>
            {column.others.length > 0 ? (
              <details className="mt-sm border-t border-border pt-sm">
                <summary className="cursor-pointer text-body-sm text-secondary hover:text-heading">Not in this campaign ({n(column.others.length)})</summary>
                <div className="mt-xs">
                  <FundList rows={column.others} narrow review={review} />
                </div>
              </details>
            ) : null}
          </section>
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
      {TIER_KEYS.map((key) => (
        <Section key={key} title={TIER_INFO[key].label} meta={n(listed(props.rows, key).length)}>
          <FundList rows={listed(props.rows, key)} review={props.review} />
        </Section>
      ))}
      <OutsideSection rows={props.rows} />
      <NearMissSection {...props} />
    </>
  );
}
