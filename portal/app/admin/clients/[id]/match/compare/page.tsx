import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import { getAdminClient } from "@/lib/data";
import { isServiceRoleConfigured } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/admin";
import { cardClass, n } from "@/app/admin/clients/[id]/match/ui";
import { RunComparisonButton } from "@/app/admin/clients/[id]/match/compare/run-button";
import {
  NEW_PLACES,
  OLD_PLACES,
  newPlaceLabel,
  oldPlaceLabel,
  type MovementRow,
} from "@/lib/match/tiers/compare";
import { RULES_VERSION, TIER_INFO, TIER_KEYS } from "@/lib/match/tiers/core";
import { listRuns, loadComparison, type ComparisonView, type RunHeader } from "@/lib/match/tiers/server";

// Running both engines and saving both runs happens in a server action here.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SHOWN = 200;

function Alert({ tone, children }: { tone: "error" | "warning"; children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className={`mb-lg rounded-card border bg-surface px-lg py-md text-body-sm ${tone === "error" ? "border-error/40 text-error" : "border-warning/40 text-warning"}`}
    >
      {children}
    </p>
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

function labelOf(value: unknown) {
  const item = value as { label?: string | null } | null | undefined;
  return item?.label ?? "–";
}

function RunFacts({ legacy, tiers }: { legacy: RunHeader; tiers: RunHeader }) {
  const inputs = tiers.profileInputs as Record<string, unknown>;
  const rel = (inputs.relationships ?? {}) as Record<string, unknown>;
  const secondaries = Array.isArray(inputs.secondarySectors) ? (inputs.secondarySectors as unknown[]).map(labelOf).join(", ") : "";
  const rows: [string, string][] = [
    ["Ran", `${when(tiers.ranAt)} by ${tiers.ranBy ?? "unknown"}`],
    ["Fund Database", `${tiers.fundDbFile || tiers.fundDbVersion} (version ${tiers.fundDbVersion.slice(0, 8)})`],
    ["Taxonomy revision", String(tiers.taxonomyRevision)],
    ["Company profile version", tiers.profileVersion != null ? String(tiers.profileVersion) : "Legacy profile (no saved version)"],
    ["Rules", `Four-tier ${tiers.rulesVersion}; current engine run ${legacy.id.slice(0, 8)}`],
    ["Primary sector", labelOf(inputs.primarySector)],
    ["Secondary sectors", secondaries || "None"],
    ["Stage", labelOf(inputs.stage)],
    ["HQ", [labelOf(inputs.hqCountry), labelOf(inputs.hqState)].filter((v) => v !== "–").join(", ")],
    ["Profile readiness", String(inputs.readiness ?? "–")],
    [
      "Sector relationships used",
      `${rel.approved ?? "?"} approved, ${rel.rejected ?? "?"} rejected, ${rel.needsReview ?? "?"} awaiting review; Cannabis → Consumer Tech: ${rel.cannabisConsumerTech ?? "?"}`,
    ],
  ];
  return (
    <dl className="grid gap-x-lg gap-y-xs text-body-sm sm:grid-cols-[14rem_1fr]">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted">{term}</dt>
          <dd className="text-secondary">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CountsTable({ view }: { view: ComparisonView }) {
  const { comparison } = view;
  const oldTotal = OLD_PLACES.filter((p) => p !== "not_listed").reduce((sum, p) => sum + comparison.oldCounts[p], 0);
  return (
    <div className="grid gap-lg md:grid-cols-2">
      <table className="w-full text-left text-body-sm">
        <caption className="mb-xs text-left text-label uppercase tracking-label text-muted">Current engine</caption>
        <tbody>
          {OLD_PLACES.filter((p) => p !== "not_listed").map((p) => (
            <tr key={p} className="border-b border-border">
              <td className="py-xs pr-md text-heading">{oldPlaceLabel(p)}</td>
              <td className="py-xs text-right tabular-nums text-secondary">{n(comparison.oldCounts[p])}</td>
            </tr>
          ))}
          <tr>
            <td className="py-xs pr-md text-muted">Listed in total</td>
            <td className="py-xs text-right tabular-nums text-muted">{n(oldTotal)}</td>
          </tr>
        </tbody>
      </table>
      <table className="w-full text-left text-body-sm">
        <caption className="mb-xs text-left text-label uppercase tracking-label text-muted">Four-tier engine</caption>
        <tbody>
          {NEW_PLACES.map((p) => (
            <tr key={p} className="border-b border-border">
              <td className="py-xs pr-md text-heading">
                {newPlaceLabel(p)}
                {(TIER_KEYS as readonly string[]).includes(p) ? (
                  <span className="block text-label text-muted">{TIER_INFO[p as (typeof TIER_KEYS)[number]].description}</span>
                ) : null}
              </td>
              <td className="py-xs text-right tabular-nums text-secondary">{n(comparison.newCounts[p])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Matrix({ view }: { view: ComparisonView }) {
  const { matrix } = view.comparison;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-body-sm">
        <thead>
          <tr className="border-b border-border text-label uppercase tracking-label text-muted">
            <th className="py-xs pr-md font-medium">Current → four-tier</th>
            {NEW_PLACES.map((p) => (
              <th key={p} className="px-xs py-xs text-right font-medium">
                {newPlaceLabel(p)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {OLD_PLACES.map((o) => (
            <tr key={o} className="border-b border-border">
              <td className="py-xs pr-md text-heading">{oldPlaceLabel(o)}</td>
              {NEW_PLACES.map((p) => (
                <td key={p} className="px-xs py-xs text-right tabular-nums text-secondary">
                  {matrix[o][p] ? n(matrix[o][p]) : <span className="text-muted">·</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Movements({ rows, empty }: { rows: MovementRow[]; empty: string }) {
  if (rows.length === 0) return <p className="text-body-sm text-muted">{empty}</p>;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-body-sm">
          <thead>
            <tr className="border-b border-border text-label uppercase tracking-label text-muted">
              <th className="py-xs pr-md font-medium">Fund</th>
              <th className="px-md py-xs font-medium">Current</th>
              <th className="px-md py-xs font-medium">Four-tier</th>
              <th className="py-xs pl-md font-medium">Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, SHOWN).map((row) => (
              <tr key={`${row.firmId}-${row.old}`} className="border-b border-border align-top">
                <td className="py-xs pr-md text-heading">
                  {row.name} <span className="font-mono text-label text-muted">{row.firmId}</span>
                </td>
                <td className="px-md py-xs text-secondary">{oldPlaceLabel(row.old)}</td>
                <td className="px-md py-xs text-secondary">{newPlaceLabel(row.next)}</td>
                <td className="py-xs pl-md text-secondary">
                  {row.why}
                  {row.notes.length ? <span className="block text-label text-muted">{row.notes.join(" · ")}</span> : null}
                  {row.duplicate ? <span className="block text-label text-warning">Possible duplicate. {row.duplicate}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > SHOWN ? (
        <p className="mt-xs text-body-sm text-muted">
          Showing {SHOWN} of {n(rows.length)}. The download has every fund.
        </p>
      ) : null}
    </>
  );
}

export default async function TierComparePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { comparison?: string };
}) {
  const client = await getAdminClient(params.id);
  if (!client) notFound();

  const header = (
    <>
      <BackLink href={`/admin/clients/${client.id}`} label={client.company_name} />
      <PageHeader
        title="Four-tier comparison"
        description={`Preview of the four-tier engine (rules ${RULES_VERSION}) next to the current engine, on the same Fund Database version and profile. The live Match page still uses the current engine; nothing here changes it, the founder's pages or exports.`}
        actions={<RunComparisonButton clientId={client.id} />}
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
  const runs = await listRuns(supabase, client.id);
  if (!runs.ok) {
    return (
      <>
        {header}
        <Alert tone="error">{runs.error}</Alert>
      </>
    );
  }
  const comparisons = Array.from(
    new Map(
      runs.value.runs.filter((r) => r.comparisonId).map((r) => [r.comparisonId!, r]),
    ).values(),
  );
  const picked = searchParams.comparison && comparisons.some((r) => r.comparisonId === searchParams.comparison)
    ? searchParams.comparison
    : comparisons[0]?.comparisonId ?? null;
  const loaded = picked ? await loadComparison(supabase, client.id, picked) : null;

  return (
    <>
      {header}
      {runs.value.since ? (
        <p className="mb-md text-body-sm text-muted">Sandbox: showing runs since its last reset ({when(runs.value.since)}). Earlier runs are kept as history.</p>
      ) : null}
      {!loaded ? (
        <p className="text-body-sm text-muted">No comparison yet. Run one to see both engines side by side.</p>
      ) : !loaded.ok ? (
        <Alert tone="error">{loaded.error}</Alert>
      ) : (
        <ComparisonBody clientId={client.id} view={loaded.value} />
      )}
      {comparisons.length > 0 ? (
        <Section title="Saved comparisons" meta={`${comparisons.length}`}>
          <ul className="space-y-xs text-body-sm">
            {comparisons.map((r) => (
              <li key={r.comparisonId}>
                <Link
                  href={`/admin/clients/${client.id}/match/compare?comparison=${r.comparisonId}`}
                  className={r.comparisonId === picked ? "text-heading underline" : "text-secondary hover:text-heading"}
                >
                  {when(r.ranAt)}
                </Link>{" "}
                <span className="text-muted">
                  by {r.ranBy ?? "unknown"} · rules {r.rulesVersion} · taxonomy {r.taxonomyRevision}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

function ComparisonBody({ clientId, view }: { clientId: string; view: ComparisonView }) {
  const inputs = view.tiers.profileInputs as Record<string, unknown>;
  const warnings = Array.isArray(inputs.warnings) ? (inputs.warnings as string[]) : [];
  const counts = view.tiers.counts as Record<string, unknown>;
  const { comparison } = view;
  return (
    <>
      {!view.complete ? (
        <Alert tone="error">This comparison is incomplete: not every result was saved. Run it again.</Alert>
      ) : null}
      {warnings.length ? (
        <div role="alert" className="mb-lg rounded-card border border-warning/40 bg-surface px-lg py-md text-body-sm text-warning">
          <p className="text-heading">Limited profile: these points are unconfirmed or unresolved.</p>
          <ul className="mt-xs list-disc pl-lg">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <Section title="Run">
        <RunFacts legacy={view.legacy} tiers={view.tiers} />
        <p className="mt-sm text-body-sm">
          <a
            href={`/admin/clients/${clientId}/match/compare/export?comparison=${view.tiers.comparisonId}`}
            className="text-secondary underline hover:text-heading"
          >
            Download the full comparison (.xlsx)
          </a>
        </p>
      </Section>
      <Section title="Counts">
        <CountsTable view={view} />
        {typeof counts.fofAlsoDirectFinancing === "number" && counts.fofAlsoDirectFinancing > 0 ? (
          <p className="mt-sm text-body-sm text-muted">
            {n(counts.fofAlsoDirectFinancing)} of the funds of funds excluded also list the company&apos;s financing type.
          </p>
        ) : null}
      </Section>
      <Section title="Where each fund went">
        <Matrix view={view} />
      </Section>
      <Section title="Reasons" meta="for funds outside the four tiers">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-body-sm">
            <thead>
              <tr className="border-b border-border text-label uppercase tracking-label text-muted">
                <th className="py-xs pr-md font-medium">Reason</th>
                <th className="px-md py-xs font-medium">Status</th>
                <th className="px-md py-xs text-right font-medium">Funds</th>
                <th className="py-xs pl-md text-right font-medium">Listed by the current engine</th>
              </tr>
            </thead>
            <tbody>
              {comparison.reasons.map((r) => (
                <tr key={r.code} className="border-b border-border">
                  <td className="py-xs pr-md text-heading">{r.label}</td>
                  <td className="px-md py-xs text-secondary">{r.status}</td>
                  <td className="px-md py-xs text-right tabular-nums text-secondary">{n(r.funds)}</td>
                  <td className="py-xs pl-md text-right tabular-nums text-secondary">{n(r.wereListed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="Listed before, not in a tier now" meta={n(comparison.dropped.length)}>
        <Movements rows={comparison.dropped} empty="None." />
      </Section>
      <Section title="New in a tier" meta={n(comparison.added.length)}>
        <Movements rows={comparison.added} empty="None." />
      </Section>
      <Section title="Possible duplicates in these results" meta={`${n(comparison.duplicates.length)} · flagged only, nothing merged`}>
        <Movements rows={comparison.duplicates} empty="None." />
      </Section>
    </>
  );
}
