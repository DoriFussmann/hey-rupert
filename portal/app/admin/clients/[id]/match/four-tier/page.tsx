import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import { getAdminClient } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { cardClass, n } from "@/app/admin/clients/[id]/match/ui";
import { RunFourTierButton } from "@/app/admin/clients/[id]/match/four-tier/run-button";
import type { StoredResult } from "@/lib/match/tiers/compare";
import { reasonLabel } from "@/lib/match/tiers/compare";
import {
  NOTE_LABEL,
  RULES_VERSION,
  TIER_INFO,
  TIER_KEYS,
  type IdentityDetail,
  type NoteCode,
  type PersonRecord,
  type TierKey,
} from "@/lib/match/tiers/core";
import { runFacts, storedCounts } from "@/lib/match/tiers/export";
import { listRuns, loadTierRun, type RunHeader } from "@/lib/match/tiers/server";

// Running the engine and saving the run happens in a server action here.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SHOWN = 150;

function Alert({ tone, children }: { tone: "error" | "warning"; children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className={`mb-lg rounded-card border bg-surface px-lg py-md text-body-sm ${tone === "error" ? "border-error/40 text-error" : "border-warning/40 text-warning"}`}
    >
      {children}
    </div>
  );
}

function Section({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <section className={`${cardClass} mb-lg px-lg py-md`}>
      <h2 className="text-h4 text-heading">
        {title} {meta ? <span className="text-body-sm font-normal text-muted">{meta}</span> : null}
      </h2>
      <div className="mt-sm">{children}</div>
    </section>
  );
}

function when(iso: string) {
  return iso ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "–";
}

type Check = { result: string; detail: string };

function FundDetails({ row }: { row: StoredResult }) {
  const checks = (row.detail.checks ?? {}) as Record<string, Check>;
  const people = (row.detail.people ?? []) as PersonRecord[];
  const identity = row.detail.identity as IdentityDetail | undefined;
  const notes = ((row.detail.notes ?? []) as string[]).map((code) => NOTE_LABEL[code as NoteCode] ?? code);
  const sectors = (row.detail.sectorTags ?? []) as string[];
  const order: [string, string][] = [
    ["firmType", "Firm type"],
    ["financing", "Financing"],
    ["stage", "Stage"],
    ["geography", "Geography"],
    ["sector", "Sector"],
  ];
  return (
    <div className="mt-xs space-y-xs text-body-sm">
      <dl className="grid gap-x-md gap-y-xs sm:grid-cols-[8rem_1fr]">
        {order
          .filter(([key]) => checks[key])
          .map(([key, title]) => (
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
      {row.detail.rejected ? <p className="text-warning">Rejected for this client: {String(row.detail.rejected)}</p> : null}
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
              {p.fid !== row.firmId ? ` (record ${p.fid})` : ""}
            </li>
          ))}
          {people.length > 8 ? <li className="text-muted">and {people.length - 8} more in the export</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

function FundList({ rows }: { rows: StoredResult[] }) {
  if (rows.length === 0) return <p className="text-body-sm text-muted">None.</p>;
  return (
    <>
      <ul className="divide-y divide-border">
        {rows.slice(0, SHOWN).map((row) => (
          <li key={row.firmId} className="py-xs">
            <details>
              <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-sm [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 text-body-sm text-heading">
                  {row.firmName} <span className="font-mono text-label text-muted">{row.firmId}</span>
                  {row.detail.identity ? <span className="ml-xs text-label text-muted">· one of {(row.detail.identity as IdentityDetail).members.length} records</span> : null}
                  {row.detail.rejected ? <span className="ml-xs text-label text-warning">· rejected</span> : null}
                </span>
                <span className="text-body-sm tabular-nums text-muted">{row.score != null ? `Fit ${row.score}` : reasonLabel(row.reasonCodes[row.reasonCodes.length - 1] ?? "")}</span>
              </summary>
              <FundDetails row={row} />
            </details>
          </li>
        ))}
      </ul>
      {rows.length > SHOWN ? <p className="mt-xs text-body-sm text-muted">Showing {SHOWN} of {n(rows.length)}. The export has every fund.</p> : null}
    </>
  );
}

export default async function FourTierPreviewPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { run?: string };
}) {
  const client = await getAdminClient(params.id);
  if (!client) notFound();
  const header = (
    <>
      <BackLink href={`/admin/clients/${client.id}`} label={client.company_name} />
      <PageHeader
        title="Four-tier match (preview)"
        description={`Rules ${RULES_VERSION}. Admin preview only: the live Match page still uses the current engine, and four-tier lists can't be pushed to the founder yet.`}
        actions={<RunFourTierButton clientId={client.id} />}
      />
    </>
  );
  if (!isServiceRoleConfigured()) {
    return (
      <>
        {header}
        <Alert tone="error">Service role key is not configured.</Alert>
      </>
    );
  }
  const supabase = createServiceClient();
  const runs = await listRuns(supabase, client.id, 60);
  if (!runs.ok) {
    return (
      <>
        {header}
        <Alert tone="error">{runs.error}</Alert>
      </>
    );
  }
  const tierRuns = runs.value.runs.filter((r) => r.engine === "tiers");
  const picked = searchParams.run && tierRuns.some((r) => r.id === searchParams.run) ? searchParams.run : tierRuns[0]?.id ?? null;
  const loaded = picked ? await loadTierRun(supabase, client.id, picked) : null;

  return (
    <>
      {header}
      <p className="mb-md text-body-sm">
        <Link href={`/admin/clients/${client.id}/match/compare`} className="text-secondary underline hover:text-heading">
          Compare with the current engine
        </Link>
      </p>
      {runs.value.since ? (
        <p className="mb-md text-body-sm text-muted">Sandbox: showing runs since its last reset ({when(runs.value.since)}). Earlier runs are kept as history.</p>
      ) : null}
      {!loaded ? (
        <p className="text-body-sm text-muted">No four-tier run yet for this client.</p>
      ) : !loaded.ok ? (
        <Alert tone="error">{loaded.error}</Alert>
      ) : (
        <RunBody clientId={client.id} {...loaded.value} />
      )}
      {tierRuns.length > 0 ? (
        <Section title="Saved four-tier runs" meta={`${tierRuns.length}`}>
          <ul className="space-y-xs text-body-sm">
            {tierRuns.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/admin/clients/${client.id}/match/four-tier?run=${r.id}`}
                  className={r.id === picked ? "text-heading underline" : "text-secondary hover:text-heading"}
                >
                  {when(r.ranAt)}
                </Link>{" "}
                <span className="text-muted">
                  by {r.ranBy ?? "unknown"} · rules {r.rulesVersion} · {r.comparisonId ? "comparison run" : "preview run"} ·{" "}
                  {r.saved === r.resultsExpected ? `${n(r.saved)} funds` : `incomplete (${n(r.saved)} of ${n(r.resultsExpected)})`}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

function RunBody({
  clientId,
  header,
  rows,
  complete,
}: {
  clientId: string;
  header: RunHeader;
  rows: StoredResult[];
  complete: boolean;
}) {
  const counts = storedCounts(rows);
  const facts = runFacts(header, complete);
  const warnings = Array.isArray(header.profileInputs.warnings) ? (header.profileInputs.warnings as string[]) : [];
  const listed = (tier: TierKey) => rows.filter((r) => r.status === "tiered" && r.tier === tier && !r.detail.representedBy);
  const outside = (status: "generalist" | "unresolved" | "excluded") => rows.filter((r) => r.status === status && !r.detail.representedBy);
  const nearMisses = rows.filter((r) => r.reasonCodes[r.reasonCodes.length - 1] === "stage_one_off").length;
  const base = `/admin/clients/${clientId}/match/four-tier`;
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
      <Section title="Run">
        <dl className="grid gap-x-lg gap-y-xs text-body-sm sm:grid-cols-[14rem_1fr]">
          {facts.map(([term, value], i) => (
            <div key={`${term}-${i}`} className="contents">
              <dt className="text-muted">{term}</dt>
              <dd className="text-secondary">{String(value)}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-sm flex flex-wrap gap-md text-body-sm">
          <a href={`${base}/export?run=${header.id}`} className="text-secondary underline hover:text-heading">
            Export this saved run (.xlsx)
          </a>
          <a href={`${base}/export?run=${header.id}&all=1`} className="text-secondary underline hover:text-heading">
            Export everything, including contacts with known problems
          </a>
        </div>
        <p className="mt-sm text-body-sm text-muted">
          Pushing four-tier lists to the founder is turned off until the founder pages support four tiers (Sprint 3B-2).
        </p>
      </Section>
      <Section title="Counts">
        <div className="grid gap-sm text-body-sm sm:grid-cols-4">
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
      </Section>
      {TIER_KEYS.map((key) => (
        <Section key={key} title={TIER_INFO[key].label} meta={n(listed(key).length)}>
          <FundList rows={listed(key)} />
        </Section>
      ))}
      <Section title="Outside the tiers" meta="admin only, never sent to the founder">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-body-sm">
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
        {(["generalist", "unresolved"] as const).map((status) => (
          <details key={status} className="mt-sm">
            <summary className="cursor-pointer text-body-sm text-secondary hover:text-heading">
              {status === "generalist" ? "Generalists" : "Unresolved"} ({n(outside(status).length)})
            </summary>
            <FundList rows={outside(status)} />
          </details>
        ))}
        <p className="mt-sm text-body-sm text-muted">Excluded funds and their reasons are in the export.</p>
      </Section>
      <Section title="Near misses: one stage off" meta={`${n(nearMisses)} · NOT eligible`}>
        <p className="text-body-sm text-secondary">
          Funds that list a stage next to the company&apos;s but not its own. They failed the stage check and are outside every tier. The download is
          marked NOT AN ELIGIBLE MATCH LIST and can&apos;t be pushed to the founder.
        </p>
        {nearMisses > 0 ? (
          <p className="mt-xs text-body-sm">
            <a href={`${base}/near-miss?run=${header.id}`} className="text-secondary underline hover:text-heading">
              Download near misses (NOT eligible, .xlsx)
            </a>
          </p>
        ) : null}
      </Section>
    </>
  );
}
