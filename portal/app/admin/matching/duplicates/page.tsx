import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth";
import { isServiceRoleConfigured } from "@/lib/env";
import { loadLiveDb } from "@/lib/match/db-server";
import { createServiceClient } from "@/lib/supabase/admin";
import { loadTaxonomy } from "@/lib/taxonomy/server";
import { cardClass, n } from "@/app/admin/clients/[id]/match/ui";
import { IdentityDecision } from "@/app/admin/matching/duplicates/identity-decision";
import { IDENTITY_RULE } from "@/lib/match/tiers/core";
import {
  DUPLICATE_LEVELS,
  DUPLICATE_LEVEL_INFO,
  identityProposals,
  resolveIdentities,
  type ResolvedIdentity,
} from "@/lib/match/tiers/duplicates";
import { duplicateReport, loadIdentityDecisions } from "@/lib/match/tiers/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function verifiedText(verified: Record<string, number>) {
  const parts = Object.entries(verified).map(([status, count]) => `${count} ${status.replace("_", " ")}`);
  return parts.length ? parts.join(", ") : "none checked";
}

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { dateStyle: "medium" }) : "";
}

function statusOf(group: ResolvedIdentity) {
  const d = group.decision;
  if (group.stale) return { tone: "text-warning", text: `The records changed since ${d?.decidedBy ?? "an admin"} decided on ${when(d?.decidedAt ?? null)}: not applied until decided again.` };
  if (d?.status === "confirmed") return { tone: "text-success", text: `Confirmed as one firm by ${d.decidedBy ?? "an admin"} on ${when(d.decidedAt)}: shown once per list.${d.note ? ` Note: ${d.note}` : ""}` };
  if (d?.status === "rejected") return { tone: "text-secondary", text: `Kept separate by ${d.decidedBy ?? "an admin"} on ${when(d.decidedAt)}.${d.note ? ` Note: ${d.note}` : ""}` };
  if (group.applied) return { tone: "text-secondary", text: "Offices of one firm: shown once per list automatically. Each office is still checked on its own data." };
  return { tone: "text-warning", text: "Waiting for a decision: not merged. Both records stay in the results, flagged." };
}

function GroupCard({ group }: { group: ResolvedIdentity }) {
  const status = statusOf(group);
  return (
    <div className="mb-md border-b border-border pb-md">
      <p className="text-body-sm text-heading">{group.shared}</p>
      <p className={`text-body-sm ${status.tone}`}>{status.text}</p>
      <div className="mt-xs overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-body-sm">
          <thead>
            <tr className="border-b border-border text-label uppercase tracking-label text-muted">
              <th className="py-xs pr-md font-medium">FirmID</th>
              <th className="px-md py-xs font-medium">Name</th>
              <th className="px-md py-xs font-medium">Website</th>
              <th className="px-md py-xs font-medium">HQ</th>
              <th className="px-md py-xs font-medium">Type</th>
              <th className="px-md py-xs text-right font-medium">Contacts</th>
              <th className="py-xs pl-md font-medium">Verification</th>
            </tr>
          </thead>
          <tbody>
            {group.members.map((m, i) => (
              <tr key={`${m.id}-${i}`} className="border-b border-border align-top">
                <td className="py-xs pr-md font-mono text-label text-muted">{m.id}</td>
                <td className="px-md py-xs text-heading">{m.name}</td>
                <td className="px-md py-xs text-secondary">{m.website || "–"}</td>
                <td className="px-md py-xs text-secondary">{m.location || "–"}</td>
                <td className="px-md py-xs text-secondary">{m.type || "–"}</td>
                <td className="px-md py-xs text-right tabular-nums text-secondary">{n(m.contacts)}</td>
                <td className="py-xs pl-md text-secondary">{verifiedText(m.verified)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <IdentityDecision groupKey={group.key} kind={group.kind} applied={group.applied} decided={!!group.decision && !group.stale} />
    </div>
  );
}

const SECTIONS: { title: string; note: string; match: (g: ResolvedIdentity) => boolean }[] = [
  {
    title: "Same provider ID",
    note: DUPLICATE_LEVEL_INFO.same_id.rule,
    match: (g) => g.level === "same_id",
  },
  {
    title: "Certain duplicates",
    note: `${DUPLICATE_LEVEL_INFO.certain.rule} Merged only after an admin confirms.`,
    match: (g) => g.level === "certain",
  },
  {
    title: "Offices of one firm",
    note: "Same name and website, different HQ country. Shown once per list unless an admin keeps them separate; each office is checked on its own data.",
    match: (g) => g.kind === "offices",
  },
  {
    title: "Sister funds",
    note: `${DUPLICATE_LEVEL_INFO.likely.rule} Kept separate unless an admin confirms they are one firm.`,
    match: (g) => g.level === "likely",
  },
  {
    title: "Same name, different websites",
    note: "Mostly unrelated firms. Kept separate unless an admin confirms they are one firm.",
    match: (g) => g.level === "ambiguous" && g.kind !== "offices",
  },
];

export default async function DuplicateReportPage() {
  await requireAdmin();
  const header = (
    <>
      <BackLink href="/admin/matching" label="Four-tier matching" />
      <PageHeader
        title="Possible duplicate firms"
        description="Firms in the live Fund Database that may be the same investor. A decision only changes how the four-tier engine shows them: provider records, contacts, reviews and verification stay on their own FirmIDs, and every decision is logged."
        actions={
          <a href="/admin/matching/duplicates/export" className="text-body-sm text-secondary underline hover:text-heading">
            Download (.xlsx)
          </a>
        }
      />
    </>
  );
  if (!isServiceRoleConfigured()) {
    return (
      <>
        {header}
        <p role="alert" className="text-body-sm text-error">Service role key is not configured.</p>
      </>
    );
  }
  const supabase = createServiceClient();
  const [taxonomy, live, decisions] = await Promise.all([loadTaxonomy(supabase), loadLiveDb(supabase), loadIdentityDecisions(supabase)]);
  const report = taxonomy.ok && live.ok ? await duplicateReport(supabase, live.value.db, taxonomy.value) : null;
  const error = !taxonomy.ok ? taxonomy.error : !live.ok ? live.error : !decisions.ok ? decisions.error : report && !report.ok ? report.error : null;
  if (error || !report || !report.ok || !decisions.ok) {
    return (
      <>
        {header}
        <p role="alert" className="text-body-sm text-error">{error ?? "The report could not be built."}</p>
      </>
    );
  }
  const value = report.value;
  const resolved = resolveIdentities(identityProposals(value), decisions.value);
  const waiting = resolved.filter((g) => g.level === "certain" && !g.applied && !(g.decision && !g.stale)).length;

  return (
    <>
      {header}
      <section className={`${cardClass} mb-lg px-lg py-md`}>
        <h2 className="text-h4 text-heading">Counts by confidence</h2>
        <div className="mt-sm overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-body-sm">
            <thead>
              <tr className="border-b border-border text-label uppercase tracking-label text-muted">
                <th className="py-xs pr-md font-medium">Level</th>
                <th className="px-md py-xs font-medium">Rule</th>
                <th className="px-md py-xs text-right font-medium">Groups</th>
                <th className="py-xs pl-md text-right font-medium">Firms</th>
              </tr>
            </thead>
            <tbody>
              {DUPLICATE_LEVELS.map((level) => (
                <tr key={level} className="border-b border-border align-top">
                  <td className="py-xs pr-md text-heading">{DUPLICATE_LEVEL_INFO[level].label}</td>
                  <td className="px-md py-xs text-secondary">{DUPLICATE_LEVEL_INFO[level].rule}</td>
                  <td className="px-md py-xs text-right tabular-nums text-secondary">{n(value.counts[level].groups)}</td>
                  <td className="py-xs pl-md text-right tabular-nums text-secondary">{n(value.counts[level].firms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-sm text-body-sm text-muted">
          Of {n(value.firms)} firms. {waiting > 0 ? `${waiting} certain group${waiting === 1 ? "" : "s"} waiting for confirmation.` : "No certain group is waiting."} How the shown record is chosen: {IDENTITY_RULE}
        </p>
      </section>

      {SECTIONS.map((section) => {
        const groups = resolved.filter(section.match);
        return (
          <section key={section.title} className={`${cardClass} mb-lg px-lg py-md`}>
            <h2 className="text-h4 text-heading">
              {section.title} <span className="text-body-sm font-normal text-muted">{n(groups.length)} groups</span>
            </h2>
            <p className="mt-xs text-body-sm text-muted">{section.note}</p>
            <div className="mt-sm">
              {groups.length === 0 ? <p className="text-body-sm text-muted">None.</p> : groups.slice(0, 150).map((group) => <GroupCard key={group.key} group={group} />)}
              {groups.length > 150 ? <p className="text-body-sm text-muted">Showing 150 of {n(groups.length)}. The download has every group.</p> : null}
            </div>
          </section>
        );
      })}
    </>
  );
}
